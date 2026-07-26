/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  roots: ['<rootDir>/tests/unit'],
  setupFiles: ['<rootDir>/tests/setup/environment.ts'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/core/**/*.ts',
    'src/background/**/*.ts',
    'src/bridge/**/*.ts',
    'src/storage/**/*.ts',
    'src/observability/**/*.ts',
    'src/reliability/**/*.ts',
    'src/governance/**/*.ts',
    '!src/core/diagnostics.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  clearMocks: true,
  restoreMocks: true,
};
