// metro.config.js - FIXED for expo-sqlite 15.x + Expo SDK 57 + SVG support (optional)
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname, {
  isCSSEnabled: true,
});

// 1. Add wasm as asset - required for wa-sqlite.wasm
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'wasm', 'db'])];
config.resolver.sourceExts = [...new Set([...config.resolver.sourceExts, 'cjs', 'mjs'])];

// 2. Fix for package exports (wa-sqlite uses exports)
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['browser', 'require', 'react-native'];

// 3. Allow require.context (used by sqlite web worker) + handle SVG transformer safely
let svgTransformerPath;
try {
  svgTransformerPath = require.resolve('react-native-svg-transformer/expo');
} catch (e) {
  // If react-native-svg-transformer is not installed, fall back to default expo transformer
  // To enable SVG imports, run: npm install --save-dev react-native-svg-transformer react-native-svg
  svgTransformerPath = null;
}

config.transformer = {
  ...config.transformer,
  unstable_allowRequireContext: true,
  ...(svgTransformerPath ? { babelTransformerPath: svgTransformerPath } : {}),
};

// If you have SVG transformer, you need to adjust resolver to handle svg
if (svgTransformerPath) {
  config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];
}

module.exports = config;
