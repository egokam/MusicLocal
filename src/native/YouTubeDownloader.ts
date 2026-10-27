import { NativeModule, requireOptionalNativeModule } from 'expo';

export type YouTubeVideoMatch = {
  videoId: string;
  title: string;
  artist: string;
  thumbnailURL: string;
  durationText: string;
  durationSeconds?: string;
};

export type YouTubeDownloadedAudio = {
  uri: string;
  title: string;
  artist: string;
  artworkURL: string;
};

declare class YouTubeDownloaderModule extends NativeModule<Record<string, never>> {
  searchVideos(query: string): Promise<YouTubeVideoMatch[]>;
  downloadAudio(videoId: string, title: string, artist: string, artworkURL?: string): Promise<YouTubeDownloadedAudio>;
  deleteTemporaryAudio(uri: string): void;
}

const nativeModule = requireOptionalNativeModule<YouTubeDownloaderModule>('MusiqYoutubeDownloader');

const requireNativeModule = () => {
  if (!nativeModule) {
    throw new Error('On-device YouTube downloading is available in the iOS app build only.');
  }
  return nativeModule;
};

export const YouTubeDownloaderService = {
  searchVideos: (query: string) => requireNativeModule().searchVideos(query),
  downloadAudio: (videoId: string, title: string, artist: string, artworkURL?: string) =>
    requireNativeModule().downloadAudio(videoId, title, artist, artworkURL),
  deleteTemporaryAudio: (uri: string) => requireNativeModule().deleteTemporaryAudio(uri),
};
