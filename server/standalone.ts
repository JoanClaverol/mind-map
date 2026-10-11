import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as api } from './app';

const root = new Hono();
root.route('/', api);
root.use('*', serveStatic({ root: './dist' }));
root.get('*', serveStatic({ path: './dist/index.html' }));

const port = Number(process.env.PORT ?? 5454);
// Loopback only: maps are private and the API has no auth. HOST=0.0.0.0 opts in to LAN exposure.
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: root.fetch, port, hostname }, () => {
  console.log(`mind-map listening on http://localhost:${port}`);
});
