import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './server/vite-plugin';

// Server-side secrets the Hono API needs in dev (loaded from .env; docker
// compose loads the same file for the container). Server modules must read
// these lazily (inside handlers) — module top-levels evaluate before this runs.
const SERVER_ENV = ['OPENROUTER_API_KEY', 'REFINE_MODEL', 'TRANSCRIBER_URL'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of SERVER_ENV) {
    if (env[key] !== undefined && process.env[key] === undefined) process.env[key] = env[key];
  }
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
