import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (file: string) => fileURLToPath(new URL(`./src/${file}`, import.meta.url));

const scripts: Record<string, string> = {
  inspector: src('content/inspector.ts'),
  probe: src('content/main-world.ts'),
};

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    minify: false,
    rollupOptions:
      mode in scripts
        ? { input: scripts[mode], output: { format: 'iife' as const, entryFileNames: `content/${mode}.js`, inlineDynamicImports: true } }
        : {
            input: { 'background/service-worker': src('background/service-worker.ts'), 'options/options': src('options/options.ts') },
            output: { format: 'es' as const, entryFileNames: '[name].js', chunkFileNames: 'shared/[name]-[hash].js' },
          },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
}));
