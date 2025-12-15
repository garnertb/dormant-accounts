const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    silent: 'passed-only',
    environment: 'node',
    coverage: {
      provider: 'v8',
    },
    projects: [
      'packages/*',
      {
        extends: true,
      },
    ],
  },
});
