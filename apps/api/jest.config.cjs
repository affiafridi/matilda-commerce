/** Unit tests: colocated *.spec.ts files under src/. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  ...require('./jest.shared.cjs'),
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
};
