export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Resolve TS sources before any stray compiled .js: an editor or ad-hoc tsc can emit
  // *.js next to *.ts in lib/dexrx/src, and the default order (js before ts) would shadow
  // the source (the extensionless moduleNameMapper targets rely on this order).
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.jest.json',
        isolatedModules: false,
        transpileOnly: true
      }
    ]
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/karma/'
  ],
  moduleNameMapper: {
    '^dexrx$': '<rootDir>/lib/dexrx/src/index.ts',
    '^dexrx/(.*)$': '<rootDir>/lib/dexrx/src/$1',
    '^@core/(.*)$': '<rootDir>/lib/dexrx/src/core/$1',
    '^@plugins/(.*)$': '<rootDir>/lib/dexrx/src/plugins/$1',
    '^@tests/(.*)$': '<rootDir>/tests/utils/$1',
    // Support for '../lib/dexrx' imports in tests (for source repo compatibility)
    '^\\.\\./lib/dexrx$': '<rootDir>/lib/dexrx/src/index.ts',
    '^\\.\\./lib/dexrx/src/(.*)$': '<rootDir>/lib/dexrx/src/$1',
    '^\\.\\./lib/dexrx/(.*)$': '<rootDir>/lib/dexrx/src/$1'
  },
  setupFilesAfterEnv: [
    '<rootDir>/tests/utils/setup.ts'
  ],
  collectCoverage: false,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  collectCoverageFrom: [
    "lib/dexrx/src/**/*.ts",
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/*.d.ts"
  ],
  testTimeout: 30000,
  // Force exit after tests complete to prevent Jest from waiting for Node.js workers
  // Workers close asynchronously and Jest may detect them as open handles
  // This is a known Jest limitation with Node.js worker_threads
  forceExit: true,
  detectOpenHandles: false, // Disable open handles detection (workers close asynchronously)
  modulePathIgnorePatterns: [
    '<rootDir>/lib/dexrx/package.json'
  ],
};