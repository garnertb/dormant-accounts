const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    silent: 'passed-only',
    environment: 'node',
    workspace: [
      'packages/*',
      {
        extends: true,
      },
    ],
  },
});
