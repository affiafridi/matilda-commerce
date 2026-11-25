// Shared transform settings. otplib v13 depends on ESM-only packages (@scure/@noble); Jest runs
// CommonJS, so those few packages are compiled on the fly (production runs them natively on Node 24).
module.exports = {
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: true }],
    '^.+\\.js$': [
      'ts-jest',
      {
        diagnostics: false,
        isolatedModules: true,
        tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022', esModuleInterop: true },
      },
    ],
  },
  transformIgnorePatterns: [
    '/packages/[^/]+/dist/',
    '/node_modules/(?!\\.pnpm/(@scure|@noble|@otplib|otplib)|@scure|@noble|@otplib|otplib)',
  ],
};
