# Deployment

The deployment is split into two public surfaces:

- Live editor demo: https://bilingual-editor.vercel.app/
- Project introduction page: https://bean-young.github.io/bilingual-editor/
- Translation API proxy: https://bilingual-editor.vercel.app/api/translate

## GitHub Pages

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml` and only serves
the project introduction page from `pages/`.

Required repository setting:

1. Open GitHub repository Settings.
2. Go to Pages.
3. Set Source to `GitHub Actions`.

After that, every push to `main` publishes the introduction page at:

```text
https://bean-young.github.io/bilingual-editor/
```

The workflow runs regression tests and then `npm run build:pages`.

## Vercel Live Demo and API Proxy

The editor demo itself runs on Vercel:

```text
https://bilingual-editor.vercel.app/
```

Vercel also hosts `/api/translate` for model requests:

```text
https://bilingual-editor.vercel.app/api/translate
```

Keep the Vercel project deployed with:

```bash
npx vercel deploy --prod
```

The user enters their own DeepSeek, NVIDIA/Kimi, or custom OpenAI-compatible API key in the app settings. The key is sent to the Vercel proxy for that request and is not stored on the server.

## Local Development

```bash
npm install
npm run dev
```

Local Vite development serves `/api/translate` through the dev middleware in `vite.config.js`.

## Manual Build Checks

```bash
npm run test:regression
npm run build
npm run build:pages
```
