import { defineConfig } from 'tsup';

// eslint-disable-next-line import/no-default-export -- [@vercel/style-guide@5 migration]
export default defineConfig({
  format: ['esm', 'cjs'],
  splitting: true,
  sourcemap: true,
  minify: false,
  clean: false,
  skipNodeModulesBundle: true,
  dts: true,
  external: ['node_modules'],
  entry: {
    index: 'src/index.ts',
    copilot: 'src/provider/copilot/index.ts',
  },
});
