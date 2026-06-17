const value = process.env.EXPO_PUBLIC_API_URL?.trim();

if (!value) {
  console.error('EXPO_PUBLIC_API_URL is required for release APK builds.');
  console.error('Example: $env:EXPO_PUBLIC_API_URL="http://10.159.20.167:4100"; npm run build:android:release');
  process.exit(1);
}

try {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('API URL must start with http:// or https://');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid EXPO_PUBLIC_API_URL.');
  process.exit(1);
}
