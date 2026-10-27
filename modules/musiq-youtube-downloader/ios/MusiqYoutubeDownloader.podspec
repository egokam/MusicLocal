Pod::Spec.new do |s|
  s.name = 'MusiqYoutubeDownloader'
  s.version = '1.0.0'
  s.summary = 'On-device YouTube search and audio import for Musiqapp.'
  s.description = s.summary
  s.license = { type: 'MIT' }
  s.author = 'Musiqapp'
  s.homepage = 'https://github.com/egokam/Music'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'YouTubeKit', '= 2.8.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '*.swift'
end
