# Deployment

The public version is a no-login demo:

- Static app: https://bean-young.github.io/bilingual-editor/
- Translation proxy: https://bilingual-editor.vercel.app/api/translate

## GitHub Pages

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml`.

Required repository setting:

1. Open GitHub repository Settings.
2. Go to Pages.
3. Set Source to `GitHub Actions`.

After that, every push to `main` publishes the app at:

```text
https://bean-young.github.io/bilingual-editor/
```

The workflow builds with:

```text
VITE_BASE_PATH=/bilingual-editor/
VITE_TRANSLATE_API_URL=https://bilingual-editor.vercel.app/api/translate
```

## Vercel API Proxy

GitHub Pages cannot run serverless functions. The app therefore uses the Vercel deployment as the translation proxy.

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
```
