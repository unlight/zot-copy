import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/copy.ts'],
  platform: 'node',
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  dts: false,
  fixedExtension: false,
  deps: {
    alwaysBundle: ['marked', 'marked-jira'],
    onlyBundle: ['marked', 'marked-jira'],
  },
});
