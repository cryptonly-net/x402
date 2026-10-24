const path = require('node:path');

/**
 * Jest config shared by the packages. `@cryptonly/x402` resolves to the core
 * package's source, so tests run without a build.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  moduleNameMapper: {
    '^@cryptonly/x402$': path.join(__dirname, 'packages/x402/src/index.ts'),
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
