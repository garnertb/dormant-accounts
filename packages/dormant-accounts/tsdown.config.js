import { defineConfig } from 'tsdown';

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

// eslint-disable-next-line import/no-default-export -- [@vercel/style-guide@5 migration]
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    database: 'src/database.ts',
    utils: 'src/utils.ts',
  },
  ...defaultConfig,
  target: false,
});
