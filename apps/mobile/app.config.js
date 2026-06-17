const app = {
  expo: {
    name: 'Zevryl',
    slug: 'zevryl',
    version: '0.1.4',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/zevryl-logo.png',
      resizeMode: 'contain',
      backgroundColor: '#05070B'
    },
    assetBundlePatterns: ['**/*'],
    runtimeVersion: {
      policy: 'appVersion'
    },
    plugins: [
      '@livekit/react-native-expo-plugin',
      '@config-plugins/react-native-webrtc'
    ],
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
      apiUrl: 'http://localhost:4100'
    }
  }
};

const projectId = process.env.EAS_PROJECT_ID;
const apiUrl = process.env.EXPO_PUBLIC_API_URL || app.expo.extra?.apiUrl;
const updates = projectId
  ? {
      ...app.expo.updates,
      enabled: true,
      url: `https://u.expo.dev/${projectId}`
    }
  : {
      enabled: false
    };

module.exports = {
  expo: {
    ...app.expo,
    extra: {
      ...app.expo.extra,
      apiUrl,
      eas: projectId ? { projectId } : undefined
    },
    updates
  }
};
