const app = {
  expo: {
    name: 'Zevryl',
    slug: 'zevryl',
    version: '0.1.16',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/zevryl-splash.png',
      resizeMode: 'contain',
      backgroundColor: '#111712'
    },
    assetBundlePatterns: ['**/*'],
    plugins: ['./plugins/withAndroidNetworkConfig', 'expo-notifications'],
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
      versionCode: 16,
      adaptiveIcon: {
        foregroundImage: './assets/icon.png',
        backgroundColor: '#1475F8'
      },
      usesCleartextTraffic: true,
      permissions: ['INTERNET', 'CAMERA', 'RECORD_AUDIO', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'POST_NOTIFICATIONS']
    },
    extra: {
      apiUrl: 'http://150.242.202.246:4100'
    }
  }
};

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || app.expo.extra?.apiUrl;

module.exports = {
  expo: {
    ...app.expo,
    extra: {
      ...app.expo.extra,
      apiUrl
    }
  }
};
