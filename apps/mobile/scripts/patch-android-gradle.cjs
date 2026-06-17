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

fs.writeFileSync(gradlePath, source);
console.log('Patched Android Gradle bundle settings for local release builds.');
