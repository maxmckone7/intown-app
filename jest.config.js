/**
 * Jest config for the pure-logic test suite (PRA-29).
 *
 * The code under test (lib/heatmap.ts, theme/colors.ts and their type-only
 * react-native imports) is framework-free, so we run in a plain node
 * environment and transform TypeScript with Babel here — scoped to Jest via
 * `babelrc: false` / `configFile: false` so the Metro/Expo build is untouched
 * (the repo intentionally has no root babel.config.js).
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.test.ts'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        // Node 24 runs modern JS natively, so we only need TS erasure plus
        // ESM -> CJS for Jest's module system — no @babel/preset-env.
        presets: [
          ['@babel/preset-typescript', { onlyRemoveTypeImports: true }],
        ],
        plugins: ['@babel/plugin-transform-modules-commonjs'],
      },
    ],
  },
};
