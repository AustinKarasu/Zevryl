const app = {
  expo: {
    name: 'Zevryl',
    slug: 'zevryl',
    version: '0.1.9',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/zevryl-logo.png',
      resizeMode: 'contain',
      backgroundColor: '#05070B'
    },
    assetBundlePatterns: ['**/*'],
    plugins: [],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.zevryl.mobile',
      infoPlist: {
        NSCameraUsageDescription: 'Zevryl uses your camera for video calls and profile photos.',
        NSMicrophoneUsageDescription: 'Zevryl uses your microphone for voice and video calls.',
        NSPhotoLibraryUsageDescription: 'Zevryl lets you choose profile photos and share media.'
      }
    },
    android: {
      package: 'com.zevryl.mobile',
      permissions: ['CAMERA', 'RECORD_AUDIO', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO']
    },
    extra: {
      apiUrl: ''
    }
  }
};

const apiUrl = process.env.EXPO_PUBLIC_API_URL || app.expo.extra?.apiUrl;

module.exports = {
  expo: {
    ...app.expo,
    extra: {
      ...app.expo.extra,
      apiUrl
    }
  }
};
