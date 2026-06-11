# Bilingual Editor

An Overleaf-inspired bilingual document editor for side-by-side translation, editing, and review.

Public links:

- Live demo: https://bilingual-editor.vercel.app/
- Project page: https://bean-young.github.io/bilingual-editor/
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

There is no required login flow in the public demo. The demo defaults to the NVIDIA / Kimi provider so test users can paste a free-trial Kimi-compatible key; DeepSeek and custom OpenAI-compatible providers remain available in Settings.

## Translation API

The live demo is deployed on Vercel, where `/api/translate` is available as a serverless API route:

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

## macOS App

Build a local downloadable macOS app bundle and DMG:

```bash
npm run build:mac
```

Regenerate the app icon after editing `macos/Assets/AppIcon.svg`:

```bash
npm run build:mac:icon
```

The script writes these local artifacts:

```text
release/Bilingual Editor.app
release/Bilingual-Editor-macOS.zip
release/Bilingual-Editor-macOS.dmg
```

The macOS app bundles the static editor UI and calls the hosted Vercel translation proxy. Users still enter their own model API key in Settings. The generated app is ad-hoc signed for local use, not notarized for public distribution.

The desktop wrapper serves the bundled static files through a private `127.0.0.1` server inside the app before loading them in WebKit. This avoids WebKit `file://` module-loading restrictions that can otherwise show a blank window.

To build the GitHub Pages introduction site:

```bash
npm run build:pages
```

## GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

On every push to `main`, GitHub Actions runs regression tests, builds the static
project introduction page in `pages/`, and publishes it to GitHub Pages.

## License

MIT
