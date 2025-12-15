import { defineConfig } from 'tsdown';

// eslint-disable-next-line import/no-default-export -- [@vercel/style-guide@5 migration]
export default defineConfig({
  format: ['esm', 'cjs'],
  sourcemap: true,
  minify: false,
  clean: false,
  dts: true,
  unbundle: true,
  entry: {
    index: 'src/index.ts',
    copilot: 'src/provider/copilot/index.ts',
  },
  target: false,
});
