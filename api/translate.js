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
  'Preserve the original document structure and formatting exactly where possible.',
  'For LaTeX: never translate command names, environment names, citation keys, labels, refs, file names, variables, or equations.',
  'Examples of protected LaTeX syntax: \\section, \\subsection, \\begin, \\end, \\cite{key}, \\ref{key}, \\label{key}, $...$ and equation environments.',
  'You may translate natural-language titles or prose inside braces, but keep the command itself unchanged.',
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
      'Input chunks JSON:',
      JSON.stringify(chunks),
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
