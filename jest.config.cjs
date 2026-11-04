module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  testTimeout: 45000,
  maxWorkers: 1,
};
