const NVIDIA_CHAT_COMPLETIONS_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
const MAX_CHUNKS = 24;
const MAX_CHUNK_CHARS = 12000;
const MAX_TOTAL_CHARS = 80000;

const languageNames = {
  auto: 'auto detected',
  'zh-CN': 'Chinese Simplified',
  'zh-TW': 'Chinese Traditional',
  en: 'English',
  ja: 'Japanese',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
};

const TRANSLATION_SKILL_PROMPT = [
  'You are a bilingual document translation engine for an Overleaf-like editor.',
  'Translate directly and faithfully. Do not summarize, expand, explain, or add commentary.',
  'Never polish, rewrite, or improve the language the user is actively editing. Only produce the corresponding text for the other language.',
  'Follow the source document style: preserve register, sentence rhythm, terminology, hedging, punctuation style, and academic tone.',
  'When previous target text is provided, perform a minimal-edit update on that previous target text: keep all still-correct wording unchanged and change only what is necessary to reflect the edited source.',
  'For refinement requests, use originalSource, editedSource, editSummary, and previousTarget together. The editedSource is the user-edited paragraph; previousTarget is the other side before this edit.',
  'Apply insertions, deletions, and replacements from editSummary to previousTarget with the smallest possible change.',
  'If editSummary contains added source-language text, translate that added text into the target language before inserting it into previousTarget.',
  'Do not copy newly added source-language words into the target text unless they are protected code, math, citations, labels, URLs, identifiers, or proper nouns that should remain unchanged.',
  'Do not rephrase a whole paragraph just because a small phrase changed.',
  'Preserve the original document structure and formatting exactly where possible.',
  'For LaTeX: never translate command names, environment names, citation keys, labels, refs, file names, variables, or equations.',
  'Examples of protected LaTeX syntax: \\section, \\subsection, \\begin, \\end, \\cite{key}, \\ref{key}, \\label{key}, $...$ and equation environments.',
  'Translate natural-language titles, captions, abstracts, and prose inside braces, but keep the command itself unchanged.',
  'For example, translate \\section{Introduction} as \\section{引言}, not as \\扇区{引言} and not as \\section{Introduction}.',
  'For Markdown: preserve heading markers, lists, tables, links, code fences, inline code, and math.',
  'For HTML/XML: preserve tags, attributes, entities, and structural markup.',
  'For JSON/YAML/CSV/TSV/BibTeX/RST: preserve keys, delimiters, syntax, IDs, and machine-readable fields; translate only natural-language values.',
  'Return only valid JSON with exactly this shape: {"translations":["..."]}.',
  'The translations array must have the same length and order as the input chunks.',
].join('\n');

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function safeLanguageName(code) {
  return languageNames[code] ?? code ?? 'auto detected';
}

function validateChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('chunks must be a non-empty array');
  }
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`too many chunks; max is ${MAX_CHUNKS}`);
  }

  let total = 0;
  chunks.forEach((chunk) => {
    if (typeof chunk !== 'string') {
      throw new Error('each chunk must be a string');
    }
    if (chunk.length > MAX_CHUNK_CHARS) {
      throw new Error(`chunk is too long; max is ${MAX_CHUNK_CHARS} characters`);
    }
    total += chunk.length;
  });

  if (total > MAX_TOTAL_CHARS) {
    throw new Error(`request is too long; max is ${MAX_TOTAL_CHARS} characters`);
  }
}

function validateReferences(references, chunks) {
  if (references === undefined) return null;
  if (!Array.isArray(references) || references.length !== chunks.length) {
    throw new Error('referenceTranslations must match chunks length');
  }
  references.forEach((item) => {
    if (item !== null && item !== undefined && typeof item !== 'string') {
      throw new Error('each reference translation must be a string');
    }
  });
  return references.map((item) => String(item ?? ''));
}

function validateOptionalStrings(values, chunks, name) {
  if (values === undefined) return null;
  if (!Array.isArray(values) || values.length !== chunks.length) {
    throw new Error(`${name} must match chunks length`);
  }
  values.forEach((item) => {
    if (item !== null && item !== undefined && typeof item !== 'string') {
      throw new Error(`each ${name} item must be a string`);
    }
  });
  return values.map((item) => String(item ?? ''));
}

function extractJson(content) {
  const text = String(content ?? '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('model did not return JSON');
    return JSON.parse(match[0]);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'missing NVIDIA_API_KEY' });
    return;
  }

  try {
    const body = normalizeBody(req.body);
    const chunks = body.chunks;
    validateChunks(chunks);
    const referenceTranslations = validateReferences(body.referenceTranslations, chunks);
    const originalChunks = validateOptionalStrings(body.originalChunks, chunks, 'originalChunks');
    const changeSummaries = validateOptionalStrings(body.changeSummaries, chunks, 'changeSummaries');

    const sourceLanguage = safeLanguageName(body.sourceLang);
    const targetLanguage = safeLanguageName(body.targetLang);
    const format = body.format || 'plain text';
    const mode = body.mode === 'refine' ? 'refine an edited passage' : 'initial document translation';

    const userPrompt = [
      `Task: ${mode}.`,
      `Source language: ${sourceLanguage}.`,
      `Target language: ${targetLanguage}.`,
      `Document format: ${format}.`,
      'Translate each chunk independently. Keep paragraph breaks inside each chunk.',
      referenceTranslations
        ? 'Previous target translations are provided. Update them minimally so they match the new source chunks.'
        : 'No previous target translations are provided. Produce a direct translation from scratch.',
      'Input JSON:',
      JSON.stringify(chunks.map((chunk, index) => ({
        originalSource: originalChunks?.[index] ?? null,
        editedSource: chunk,
        editSummary: changeSummaries?.[index] ?? null,
        previousTarget: referenceTranslations?.[index] ?? null,
      }))),
    ].join('\n');

    const response = await fetch(NVIDIA_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_MODEL || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: TRANSLATION_SKILL_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: Number(process.env.NVIDIA_MAX_TOKENS || 4096),
        temperature: Number(process.env.NVIDIA_TEMPERATURE || 0.1),
        top_p: 1,
        stream: false,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({
        error: payload.error?.message || payload.message || 'NVIDIA translation request failed',
      });
      return;
    }

    const content = payload.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== chunks.length) {
      throw new Error('model returned an invalid translations array');
    }

    res.status(200).json({
      translations: parsed.translations.map((item) => String(item ?? '')),
      usage: payload.usage ?? null,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'translation failed' });
  }
}
