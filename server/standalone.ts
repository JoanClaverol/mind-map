import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as api } from './app';

const root = new Hono();
root.route('/', api);
root.use('*', serveStatic({ root: './dist' }));
root.get('*', serveStatic({ path: './dist/index.html' }));

const port = Number(process.env.PORT ?? 5454);
// Loopback only: maps are private and the API has no login. Deliberately NOT the
// generic HOST variable, which some shells and CI set to the machine's hostname
// and would silently put the app on the network.
const hostname = process.env.MINDMAP_HOST ?? '127.0.0.1';
if (!/^(127\.0\.0\.1|localhost|::1)$/.test(hostname)) {
  console.warn(
    `⚠ mind-map is listening on ${hostname}: anyone who can reach this machine on port ${port} can read, change and delete every map (there is no login).`,
  );
}
serve({ fetch: root.fetch, port, hostname }, () => {
  console.log(`mind-map listening on http://localhost:${port}`);
});
