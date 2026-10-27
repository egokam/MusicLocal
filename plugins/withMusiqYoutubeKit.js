const { withPodfile } = require('expo/config-plugins');

const podLine = "  pod 'YouTubeKit', '= 2.8.0', :podspec => '../modules/musiq-youtube-downloader/ios/YouTubeKit.podspec'";

module.exports = function withMusiqYoutubeKit(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes("pod 'YouTubeKit'")) return config;

    const targetStart = "target 'Music' do\n";
    if (!contents.includes(targetStart)) {
      throw new Error("withMusiqYoutubeKit could not find the Music target in the generated Podfile.");
    }

    config.modResults.contents = contents.replace(targetStart, `${targetStart}${podLine}\n`);
    return config;
  });
};
