// HTTP-level tests (files ending in .e2e-spec.ts under src). No database is required in Phase 1.
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  ...require('./jest.shared.cjs'),
};
