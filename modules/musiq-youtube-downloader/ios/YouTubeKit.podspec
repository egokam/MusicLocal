Pod::Spec.new do |s|
  s.name = 'YouTubeKit'
  s.version = '2.8.0'
  s.summary = 'On-device YouTube search and audio stream extraction for iOS.'
  s.description = s.summary
  s.license = { type: 'MIT' }
  s.author = 'Antoine Bollengier'
  s.homepage = 'https://github.com/b5i/YouTubeKit'
  s.source = { :git => 'https://github.com/b5i/YouTubeKit.git', :tag => 'v2.8.0' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = 'Sources/YouTubeKit/**/*.swift'
  s.resources = 'Resources/YouTubeKitResources.bundle'

  s.prepare_command = <<-CMD
    mkdir -p Resources/YouTubeKitResources.bundle/JavaScript
    cp Sources/YouTubeKit/JavaScript/jsc_bundle.js Resources/YouTubeKitResources.bundle/JavaScript/jsc_bundle.js
    cat > Sources/YouTubeKit/Bundle+Resources.swift <<'SWIFT'
import Foundation

 #if !SWIFT_PACKAGE
extension Bundle {
  static var module: Bundle {
    if let url = Bundle.main.url(forResource: "YouTubeKitResources", withExtension: "bundle"),
       let bundle = Bundle(url: url) {
      return bundle
    }
    return Bundle(for: YouTubeKitResourcesBundleMarker.self)
  }
}

private final class YouTubeKitResourcesBundleMarker {}
#endif
SWIFT
  CMD
end
