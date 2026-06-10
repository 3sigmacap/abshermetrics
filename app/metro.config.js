// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

// The shared engine + datasets are synced into src/shared/ by scripts/sync-shared.js
// (run automatically via the package.json "pre" scripts), so no special resolver
// config is needed — Metro bundles them like any other in-project file.
const config = getDefaultConfig(__dirname);

module.exports = config;
