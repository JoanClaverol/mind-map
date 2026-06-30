import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as api } from './app';

const root = new Hono();
root.route('/', api);
root.use('*', serveStatic({ root: './dist' }));
root.get('*', serveStatic({ path: './dist/index.html' }));

const port = Number(process.env.PORT ?? 5454);
serve({ fetch: root.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`mind-map listening on http://localhost:${port}`);
});
