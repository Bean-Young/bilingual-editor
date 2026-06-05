# Bilingual Editor

An Overleaf-inspired bilingual document editor for side-by-side translation, editing, and review.

Public demo:

- GitHub Pages: https://bean-young.github.io/bilingual-editor/
- Vercel API proxy: https://bilingual-editor.vercel.app/api/translate

## Features

- Demo LaTeX document on first load
- Upload support for `.tex`, `.md`, `.markdown`, `.txt`, `.docx`, `.rtf`, `.html`, `.htm`, `.bib`, `.rst`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, and `.xml`
- Editable rendered view and raw source view
- Side-by-side source and translation panes
- Resizable editor panes and collapsible sidebar
- Section outline navigation
- Search with matching highlights
- Review comments as model guidance
- Idle or manual model sync for bilingual updates and grammar repair
- User-configured translation provider API keys
- Local browser storage for settings and current documents

There is no required login flow in the public demo.

## Translation API

The static GitHub Pages build cannot host `/api/translate`, so it calls the Vercel proxy by default:

```text
https://bilingual-editor.vercel.app/api/translate
```

The app still requires the user to configure their own provider API key in Settings. Keys are stored in the current browser only and are sent to the proxy for the translation request.

To override the proxy endpoint at build time:

```bash
VITE_TRANSLATE_API_URL=https://your-domain.example/api/translate npm run build
```

## Local Development

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. In local development, Vite serves `api/translate.js` as a dev middleware.

## Build

```bash
npm run test:regression
npm run build
```

The production build is written to `dist/`.

## GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

On every push to `main`, GitHub Actions runs regression tests, builds with:

```text
VITE_BASE_PATH=/bilingual-editor/
VITE_TRANSLATE_API_URL=https://bilingual-editor.vercel.app/api/translate
```

and publishes `dist` to GitHub Pages.

## License

MIT
