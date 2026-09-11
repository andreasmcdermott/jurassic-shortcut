import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createShortcutRouter } from './shortcut.js';
import { ResponseCache } from './cache.js';

const app = express();
const port = Number(process.env.PORT || 1993);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.disable('x-powered-by');
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', createShortcutRouter({ cache: new ResponseCache(path.join(root, '.shortcut-cache')) }));
if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, '127.0.0.1', () => console.log(`Shortcut fsn is running at http://127.0.0.1:${port}`));
