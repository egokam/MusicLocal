import AVFoundation
import CoreMedia
import ExpoModulesCore
import Foundation
import UIKit
import YouTubeKit

public class MusiqYoutubeDownloaderModule: Module {
  private let maximumAudioBytes: Int64 = 512 * 1024 * 1024
  private let maximumArtworkBytes = 15 * 1024 * 1024

  public func definition() -> ModuleDefinition {
    Name("MusiqYoutubeDownloader")

    AsyncFunction("searchVideos") { (query: String) async throws -> [[String: String]] in
      try await self.searchVideos(query: query)
    }

    AsyncFunction("downloadAudio") { (videoID: String, title: String, artist: String, artworkURL: String?) async throws -> [String: String] in
      try await self.downloadAudio(videoID: videoID, title: title, artist: artist, artworkURL: artworkURL)
    }

    Function("deleteTemporaryAudio") { (uri: String) throws in
      try self.deleteTemporaryAudio(uri: uri)
    }
  }

  private func searchVideos(query: String) async throws -> [[String: String]] {
    let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedQuery.isEmpty else {
      throw moduleError("Enter a track name before searching YouTube.")
    }

    let model = YouTubeModel()
    model.selectedLocale = "en-US"
    let response = try await SearchResponse.sendThrowingRequest(
      youtubeModel: model,
      data: [.query: normalizedQuery],
      useCookies: nil
    )

    return response.results.compactMap { result in
      guard
        let video = result as? YTVideo,
        video.memberOnly != true,
        let title = video.title?.trimmingCharacters(in: .whitespacesAndNewlines),
        !title.isEmpty
      else {
        return nil
      }

      var item: [String: String] = [
        "videoId": video.videoId,
        "title": title,
        "artist": video.channel?.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
        "thumbnailURL": video.thumbnails.last?.url.absoluteString ?? "",
        "durationText": video.timeLength ?? "",
      ]
      if let seconds = video.timeLengthSeconds {
        item["durationSeconds"] = String(seconds)
      }
      return item
    }
    .prefix(12)
    .map { $0 }
  }

  private func downloadAudio(videoID: String, title: String, artist: String, artworkURL: String?) async throws -> [String: String] {
    guard videoID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw moduleError("That YouTube video link is not valid.")
    }

    let model = YouTubeModel()
    model.selectedLocale = "en-US"
    let video = YTVideo(videoId: videoID)
    let response = try await video.fetchStreamingInfosWithDownloadFormatsThrowing(youtubeModel: model, useCookies: nil)
    let audioFormat = response.downloadFormats
      .compactMap { $0 as? AudioOnlyFormat }
      .filter { ($0.mimeType ?? "").lowercased().hasPrefix("audio/mp4") && $0.url != nil }
      .max { ($0.averageBitrate ?? 0) < ($1.averageBitrate ?? 0) }

    guard let audioFormat, let streamURL = audioFormat.url, streamURL.scheme == "https" else {
      throw moduleError("YouTube did not provide a compatible M4A audio stream for this video.")
    }

    if let length = audioFormat.contentLength, length > Int(maximumAudioBytes) {
      throw moduleError("Audio files must be smaller than 512 MB.")
    }

    var request = URLRequest(url: streamURL)
    request.timeoutInterval = 60
    if let length = audioFormat.contentLength, length > 0 {
      request.setValue("bytes=0-\(length - 1)", forHTTPHeaderField: "Range")
    }

    let (temporaryURL, responseValue) = try await URLSession.shared.download(for: request)
    guard let httpResponse = responseValue as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
      throw moduleError("YouTube refused the audio download. Try another result.")
    }

    let downloadedBytes = (try FileManager.default.attributesOfItem(atPath: temporaryURL.path)[.size] as? NSNumber)?.int64Value ?? 0
    guard downloadedBytes > 0 else {
      throw moduleError("YouTube returned an empty audio file.")
    }
    guard downloadedBytes <= maximumAudioBytes else {
      throw moduleError("Audio files must be smaller than 512 MB.")
    }

    let directory = try temporaryAudioDirectory()
    let sourceURL = directory.appendingPathComponent("source-\(UUID().uuidString).m4a")
    let taggedURL = directory.appendingPathComponent("track-\(UUID().uuidString).m4a")
    try FileManager.default.moveItem(at: temporaryURL, to: sourceURL)

    do {
      let resolvedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? (response.videoInfos.title ?? "Untitled track")
        : title.trimmingCharacters(in: .whitespacesAndNewlines)
      let resolvedArtist = artist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? (response.videoInfos.channel?.name ?? "Unknown artist")
        : artist.trimmingCharacters(in: .whitespacesAndNewlines)
      let resolvedArtworkURL = artworkURL?.isEmpty == false
        ? artworkURL
        : response.videoInfos.thumbnails.last?.url.absoluteString
      let artwork = await downloadArtwork(from: resolvedArtworkURL)
      try await writeMetadata(
        sourceURL: sourceURL,
        destinationURL: taggedURL,
        title: resolvedTitle,
        artist: resolvedArtist,
        artwork: artwork
      )
      try? FileManager.default.removeItem(at: sourceURL)
      return [
        "uri": taggedURL.absoluteString,
        "title": resolvedTitle,
        "artist": resolvedArtist,
        "artworkURL": resolvedArtworkURL ?? "",
      ]
    } catch {
      try? FileManager.default.removeItem(at: sourceURL)
      try? FileManager.default.removeItem(at: taggedURL)
      throw error
    }
  }

  private func downloadArtwork(from value: String?) async -> Data? {
    guard
      let value,
      let url = URL(string: value),
      url.scheme == "https"
    else {
      return nil
    }

    do {
      var request = URLRequest(url: url)
      request.timeoutInterval = 20
      let (data, responseValue) = try await URLSession.shared.data(for: request)
      guard
        let response = responseValue as? HTTPURLResponse,
        (200...299).contains(response.statusCode),
        data.count <= maximumArtworkBytes,
        let image = UIImage(data: data)
      else {
        return nil
      }
      return image.jpegData(compressionQuality: 0.9)
    } catch {
      return nil
    }
  }

  private func writeMetadata(sourceURL: URL, destinationURL: URL, title: String, artist: String, artwork: Data?) async throws {
    let asset = AVURLAsset(url: sourceURL)
    guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
      throw moduleError("Could not prepare the downloaded audio for saving.")
    }
    guard exportSession.supportedFileTypes.contains(.m4a) else {
      throw moduleError("This M4A audio file cannot be saved with embedded track details on this iPhone.")
    }

    var metadata = [
      metadataItem(identifier: .commonIdentifierTitle, value: title as NSString),
      metadataItem(identifier: .commonIdentifierArtist, value: artist as NSString),
    ]
    if let artwork {
      metadata.append(metadataItem(identifier: .commonIdentifierArtwork, value: artwork as NSData, dataType: kCMMetadataBaseDataType_JPEG as String))
    }

    exportSession.outputURL = destinationURL
    exportSession.outputFileType = .m4a
    exportSession.metadata = metadata
    exportSession.shouldOptimizeForNetworkUse = false

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      exportSession.exportAsynchronously {
        switch exportSession.status {
        case .completed:
          continuation.resume()
        case .failed:
          continuation.resume(throwing: exportSession.error ?? self.moduleError("Could not embed track details in the downloaded audio."))
        case .cancelled:
          continuation.resume(throwing: self.moduleError("Saving the downloaded audio was cancelled."))
        default:
          continuation.resume(throwing: self.moduleError("The downloaded audio could not be finalized."))
        }
      }
    }
  }

  private func metadataItem(identifier: AVMetadataIdentifier, value: NSCopying & NSObjectProtocol, dataType: String? = nil) -> AVMutableMetadataItem {
    let item = AVMutableMetadataItem()
    item.identifier = identifier
    item.value = value
    item.dataType = dataType
    return item
  }

  private func temporaryAudioDirectory() throws -> URL {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw moduleError("Could not open app storage for the downloaded audio.")
    }
    let directory = caches.appendingPathComponent("MusiqYouTubeDownloads", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func deleteTemporaryAudio(uri: String) throws {
    guard let url = URL(string: uri), url.isFileURL else {
      throw moduleError("The temporary audio file could not be found.")
    }
    let directory = try temporaryAudioDirectory().standardizedFileURL.path + "/"
    let target = url.standardizedFileURL.path
    guard target.hasPrefix(directory) else {
      throw moduleError("The temporary audio file could not be removed.")
    }
    if FileManager.default.fileExists(atPath: target) {
      try FileManager.default.removeItem(at: url)
    }
  }

  private func moduleError(_ message: String) -> NSError {
    NSError(domain: "MusiqYoutubeDownloader", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
