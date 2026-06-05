import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import translateHandler from './api/translate.js';
import { spawn } from 'node:child_process';

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function proxyWithCurl(url, method, contentType, body) {
  return new Promise((resolve, reject) => {
    const marker = '\n__HTTP_STATUS__:';
    const child = spawn('curl', [
      '-sS',
      '-X', method,
      '-H', `Content-Type: ${contentType || 'application/json'}`,
      '--data-binary', '@-',
      '-w', `${marker}%{http_code}`,
      url,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `curl exited with ${code}`));
        return;
      }
      const markerIndex = stdout.lastIndexOf(marker);
      if (markerIndex === -1) {
        reject(new Error('curl response missing status marker'));
        return;
      }
      resolve({
        body: stdout.slice(0, markerIndex),
        status: Number(stdout.slice(markerIndex + marker.length).trim()) || 502,
      });
    });
    child.stdin.end(body);
  });
}

function devApiPlugin() {
  return {
    name: 'dev-api-translate',
    configureServer(server) {
      server.middlewares.use('/api/translate', async (req, res) => {
        const rawBody = await readRequestBody(req);
        const proxyUrl = process.env.DEV_TRANSLATE_PROXY_URL;
        if (!process.env.NVIDIA_API_KEY && proxyUrl && proxyUrl !== 'none') {
          try {
            const response = await proxyWithCurl(proxyUrl, req.method, req.headers['content-type'], rawBody);
            res.statusCode = response.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(response.body);
          } catch (error) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `dev translate proxy failed: ${error.message}` }));
          }
          return;
        }
        const apiReq = {
          method: req.method,
          body: rawBody,
        };
        const apiRes = {
          setHeader: (name, value) => res.setHeader(name, value),
          status(code) {
            res.statusCode = code;
            return this;
          },
          json(payload) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
          },
        };
        await translateHandler(apiReq, apiRes);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    base: './',
    plugins: [react(), devApiPlugin()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
