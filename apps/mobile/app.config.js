const app = require('./app.json');

const projectId = process.env.EAS_PROJECT_ID;
const apiUrl = process.env.EXPO_PUBLIC_API_URL || app.expo.extra?.apiUrl;
const updatesEnabled = Boolean(projectId);

module.exports = {
  expo: {
    ...app.expo,
    extra: {
      ...app.expo.extra,
      apiUrl,
      eas: projectId ? { projectId } : undefined
    },
    updates: {
      ...app.expo.updates,
      enabled: updatesEnabled,
      url: projectId ? `https://u.expo.dev/${projectId}` : app.expo.updates?.url
    }
  }
};
