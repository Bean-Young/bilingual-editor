import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const pages = resolve(root, 'pages');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(pages, dist, { recursive: true });
