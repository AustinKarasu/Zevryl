const fs = require('node:fs');
const path = require('node:path');

const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');

if (!fs.existsSync(gradlePath)) {
  throw new Error(`Android Gradle file not found: ${gradlePath}. Run expo prebuild first.`);
}

let source = fs.readFileSync(gradlePath, 'utf8');

if (!source.includes('def workspaceRoot =')) {
  source = source.replace(
    'def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()',
    [
      'def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()',
      'def workspaceRoot = rootDir.getAbsoluteFile().getParentFile().getParentFile().getParentFile().getAbsolutePath()'
    ].join('\n')
  );
}

source = source.replace(
  /react \{\r?\n\s+entryFile = file\(\["node", "-e", "require\('expo\/scripts\/resolveAppEntry'\)", projectRoot, "android", "absolute"\]\.execute\(null, rootDir\)\.text\.trim\(\)\)/,
  'react {\n    root = file(workspaceRoot)\n    entryFile = new File(projectRoot, "index.ts")'
);

if (!source.includes('root = file(workspaceRoot)') || !source.includes('entryFile = new File(projectRoot, "index.ts")')) {
  throw new Error('Failed to patch React Native Gradle bundle settings.');
}

if (!source.includes('def releaseStoreFile = System.getenv("ZEVRYL_RELEASE_STORE_FILE")')) {
  source = source.replace(
    '    signingConfigs {\n        debug {',
    [
      '    signingConfigs {',
      '        release {',
      '            def releaseStoreFile = System.getenv("ZEVRYL_RELEASE_STORE_FILE")',
      '            if (releaseStoreFile) {',
      '                storeFile file(releaseStoreFile)',
      '                storePassword System.getenv("ZEVRYL_RELEASE_STORE_PASSWORD")',
      '                keyAlias System.getenv("ZEVRYL_RELEASE_KEY_ALIAS")',
      '                keyPassword System.getenv("ZEVRYL_RELEASE_KEY_PASSWORD")',
      '            }',
      '        }',
      '        debug {'
    ].join('\n')
  );
}

source = source.replace(
  /release \{\r?\n\s+\/\/ Caution! In production, you need to generate your own keystore file\.\r?\n\s+\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\r?\n\s+signingConfig signingConfigs\.debug/,
  [
    'release {',
    '            // Caution! In production, you need to generate your own keystore file.',
    '            // see https://reactnative.dev/docs/signed-apk-android.',
    '            signingConfig System.getenv("ZEVRYL_RELEASE_STORE_FILE") ? signingConfigs.release : signingConfigs.debug'
  ].join('\n')
);

if (!source.includes('release {\n            // Caution! In production, you need to generate your own keystore file.\n            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig System.getenv("ZEVRYL_RELEASE_STORE_FILE") ? signingConfigs.release : signingConfigs.debug')) {
  throw new Error('Failed to patch Android release signing settings.');
}

fs.writeFileSync(gradlePath, source);
console.log('Patched Android Gradle bundle settings for local release builds.');
