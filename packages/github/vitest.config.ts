import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [],
  test: { environment: 'node', silent: 'passed-only' },
});
