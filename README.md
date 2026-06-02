# Bilingual Document Editor

An Overleaf-inspired bilingual document editor for writing, translating, and reviewing source documents side by side.

## Features

- Supabase email/password registration and login
- Cloud document list for each signed-in user
- Shared document access with owner/editor permissions
- Realtime document sync for collaborators
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

Without Supabase environment variables the app runs in local-only mode. To enable users, cloud documents, and collaboration, create `.env.local`:

```bash
cp .env.example .env.local
```

Then set:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Run the SQL in `supabase/schema.sql` inside the Supabase SQL Editor. It creates:

- `profiles`
- `documents`
- `document_collaborators`
- row-level security policies
- `invite_collaborator_by_email(...)`

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

In Vercel, add these project environment variables before deploying the login-enabled version:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## License

MIT
