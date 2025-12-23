// Jest configuration
module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/*.test.js'],
  verbose: true,
  collectCoverage: false,
  transform: {},
  // Mock external dependencies
  moduleNameMapper: {
    '^moment$': '<rootDir>/__mocks__/moment.js',
    '^dotenv$': '<rootDir>/__mocks__/dotenv.js',
  }
};
