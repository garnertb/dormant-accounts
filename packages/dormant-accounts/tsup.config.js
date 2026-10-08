import { defineConfig } from 'tsup';

const defaultConfig = {
  format: ['esm', 'cjs'],
  splitting: true,
  sourcemap: true,
  minify: false,
  clean: true,
  skipNodeModulesBundle: true,
  dts: true,
  external: [/^node:.*/, 'node_modules'],
};

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    database: 'src/database.ts',
    utils: 'src/utils.ts',
  },
  ...defaultConfig,
});
