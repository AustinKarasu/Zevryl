const { withMainApplication } = require('@expo/config-plugins');

module.exports = function withLiveKitAndroid(config) {
  return withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') return mod;
    let source = mod.modResults.contents;
    if (!source.includes('com.livekit.reactnative.LiveKitReactNative')) {
      source = source.replace(
        'import com.facebook.react.defaults.DefaultReactNativeHost\n',
        'import com.facebook.react.defaults.DefaultReactNativeHost\nimport com.livekit.reactnative.LiveKitReactNative\nimport com.livekit.reactnative.audio.AudioType\n'
      );
    }
    if (!source.includes('LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())')) {
      source = source.replace(
        '  override fun onCreate() {\n    super.onCreate()\n',
        '  override fun onCreate() {\n    super.onCreate()\n    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())\n'
      );
    }
    mod.modResults.contents = source;
    return mod;
  });
};
