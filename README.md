# Bilingual Document Editor

An Overleaf-inspired bilingual document editor for writing, translating, and reviewing source documents side by side.

## Features

- Side-by-side source and translation editing
- Editable rendered view and raw source view
- Resizable editor panes
- Section outline navigation
- Synchronized bilingual comments with highlighted quoted text
- Theme color and language direction settings
- Upload support for LaTeX, Markdown, text, Word, RTF, HTML, BibTeX, reStructuredText, CSV, TSV, JSON, YAML, and XML
- Export text from either side

## Tech Stack

- React
- Vite
- Lucide React icons
- Mammoth for Word text extraction
- Vercel deployment configuration

## Local Development

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Build

```bash
npm run build
```

The production build is written to `dist/`.

## Deployment

This project includes `vercel.json` and is ready to deploy to Vercel:

```bash
npx vercel deploy --prod
```

## License

MIT
