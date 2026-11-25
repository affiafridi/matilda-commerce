// Database-backed tests (files ending in .int-spec.ts under src). Require `pnpm docker:up`.
// Environment is loaded here (main process) so every test file's sandbox inherits it.
try {
  process.loadEnvFile('.env');
} catch {
  // Variables may already be set in the environment (e.g., CI).
}

module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.int-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  ...require('./jest.shared.cjs'),
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/jest-global-setup.cjs',
};
