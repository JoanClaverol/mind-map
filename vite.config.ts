import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './server/vite-plugin';

export default defineConfig(() => {
  return {
    plugins: [react(), apiPlugin()],
    server: { port: 5454, strictPort: true },
    preview: { port: 5454, strictPort: true },
    test: {
      include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
      environment: 'node',
    },
  };
});
