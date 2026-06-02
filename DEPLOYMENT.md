# Deployment Checklist

The app is deployed to Vercel and can run in two modes:

- Local-only mode: no Supabase environment variables.
- Cloud mode: Supabase variables are configured, enabling registration, login, cloud documents, sharing, and realtime collaboration.

## 1. Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run all SQL in `supabase/schema.sql`.
4. In Supabase Authentication settings, enable Email provider.
5. Copy:
   - Project URL
   - Project anon public key

## 2. Vercel Environment Variables

Add these variables in the Vercel project:

```bash
npx vercel env add VITE_SUPABASE_URL production
npx vercel env add VITE_SUPABASE_ANON_KEY production
```

Then redeploy:

```bash
npx vercel deploy --prod
```

The login screen appears only after these variables exist at build time.

## 3. Domain Setup

Current Vercel production URL:

```text
https://bilingual-editor.vercel.app
```

To use `translate.qd.je`, configure the domain registrar DNS. If using Vercel nameservers, set:

```text
ns1.vercel-dns.com
ns2.vercel-dns.com
```

After DNS propagates, bind the alias:

```bash
npx vercel alias set bilingual-editor.vercel.app translate.qd.je
```

If Vercel still says the domain is not accessible, wait for DNS propagation and retry.

## 4. Collaboration Model

Collaboration currently uses document-level realtime updates:

- Owner can invite registered users by email.
- Editor collaborators can update the same document.
- Latest saved document state wins.

For character-level Google Docs style merging, the next step is adding a CRDT layer such as Yjs.
