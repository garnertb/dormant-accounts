import { defineConfig } from 'tsup';

// eslint-disable-next-line import/no-default-export -- [@vercel/style-guide@5 migration]
export default defineConfig({
  format: ['esm', 'cjs'],
  sourcemap: true,
  minify: false,
  clean: false,
  skipNodeModulesBundle: true,
  dts: true,
  entry: {
    index: 'src/index.ts',
  },
});
