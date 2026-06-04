import { ECDICT_EN_TO_ZH_TERMS } from '../src/translation/publicEcdictTerms.js';
import { PUBLIC_EN_TO_ZH_TERMS, PUBLIC_ZH_TO_EN_TERMS } from '../src/translation/publicZhEnTerms.js';

const NVIDIA_CHAT_COMPLETIONS_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
const MAX_CHUNKS = 24;
const MAX_CHUNK_CHARS = 12000;
const MAX_TOTAL_CHARS = 80000;
const enToZhTerms = buildTermList([...PUBLIC_EN_TO_ZH_TERMS, ...ECDICT_EN_TO_ZH_TERMS], 'en');
const zhToEnTerms = buildTermList(PUBLIC_ZH_TO_EN_TERMS, 'zh');
const UI_EN_ZH_FALLBACK_TERMS = [
  { source: 'large language models', target: '大型语言模型' },
  { source: 'large language model', target: '大型语言模型' },
  { source: 'hello', target: '你好' },
];
const UI_ZH_EN_FALLBACK_TERMS = [
  { source: '大型语言模型', target: 'large language models' },
  { source: '大语言模型', target: 'large language models' },
  { source: '语言模型', target: 'language models' },
  { source: '你好', target: 'hello' },
];

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
  'For patch requests, editedSource is only the newly inserted source fragment. Return only the translated fragment to insert on the other side, not the full paragraph and not previousTarget.',
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

function buildTermList(entries, language) {
  const seen = new Set();
  return entries
    .filter(({ source, target }) => source && target && source !== target)
    .filter(({ source }) => {
      const key = language === 'en' ? source.toLowerCase() : source;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.source.length - a.source.length || a.source.localeCompare(b.source));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyEnglishTerms(text, terms) {
  const lowerText = text.toLowerCase();
  let output = text;

  terms.forEach(({ source, target }) => {
    if (!source || !target || !lowerText.includes(source.toLowerCase())) return;
    const pattern = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(source)})(?=$|[^A-Za-z0-9])`, 'gi');
    output = output.replace(pattern, (match, prefix) => `${prefix}${target}`);
  });

  return output;
}

function applyChineseTerms(text, terms) {
  let output = text;
  terms.forEach(({ source, target }) => {
    if (source && target && output.includes(source)) {
      output = output.replaceAll(source, ` ${target} `);
    }
  });
  return output
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
    .trim();
}

function localTranslateInsertedText(text, sourceLang, targetLang) {
  const clean = String(text ?? '').trim();
  if (!clean) return '';
  if (targetLang === 'zh-CN' || targetLang === 'zh-TW') {
    return applyEnglishTerms(applyEnglishTerms(clean, UI_EN_ZH_FALLBACK_TERMS), enToZhTerms).trim();
  }
  if (targetLang === 'en') {
    return applyChineseTerms(applyChineseTerms(clean, UI_ZH_EN_FALLBACK_TERMS), zhToEnTerms).trim();
  }
  return clean;
}

function parseAddedText(summary) {
  const match = String(summary ?? '').match(/added:\s*("(?:\\.|[^"\\])*")/);
  if (!match) return '';
  try {
    return JSON.parse(match[1]);
  } catch {
    return '';
  }
}

function enforceInsertedTextLanguage(output, addedText, sourceLang, targetLang) {
  const cleanAdded = String(addedText ?? '').trim();
  if (!cleanAdded) return output;
  const translatedAdded = localTranslateInsertedText(cleanAdded, sourceLang, targetLang);
  if (!translatedAdded || translatedAdded === cleanAdded) return output;

  const pattern = sourceLang === 'en'
    ? new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(cleanAdded)})(?=$|[^A-Za-z0-9])`, 'gi')
    : new RegExp(escapeRegExp(cleanAdded), 'g');

  return output.replace(pattern, (...args) => {
    const prefix = sourceLang === 'en' ? args[1] : '';
    return `${prefix}${translatedAdded}`;
  });
}

function sanitizePatchTranslation(output, addedText, sourceLang, targetLang, previousTarget) {
  const cleanAdded = String(addedText ?? '').trim();
  const translatedAdded = localTranslateInsertedText(cleanAdded, sourceLang, targetLang);
  const cleanOutput = String(output ?? '').trim();
  if (!cleanOutput) return translatedAdded;
  if (!translatedAdded || translatedAdded === cleanAdded) return cleanOutput;

  const targetText = String(previousTarget ?? '').trim();
  const returnedFullTarget = targetText && cleanOutput.includes(targetText);
  const tooLongForPatch = cleanOutput.length > Math.max(80, translatedAdded.length * 5, cleanAdded.length * 5);
  if (returnedFullTarget || tooLongForPatch) return translatedAdded;
  return cleanOutput;
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
    const isPatchMode = body.mode === 'patch';
    const mode = isPatchMode
      ? 'translate inserted fragments for local bilingual sync'
      : body.mode === 'refine'
        ? 'refine an edited passage'
        : 'initial document translation';

    const userPrompt = [
      `Task: ${mode}.`,
      `Source language: ${sourceLanguage}.`,
      `Target language: ${targetLanguage}.`,
      `Document format: ${format}.`,
      isPatchMode
        ? 'Each editedSource is only the user-added fragment. Return only the translated fragment for each item.'
        : 'Translate each chunk independently. Keep paragraph breaks inside each chunk.',
      isPatchMode
        ? 'Use originalSource and previousTarget only as context for terminology and style. Do not return previousTarget or a full paragraph.'
        : referenceTranslations
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

    const translations = parsed.translations.map((item, index) => {
      const addedText = parseAddedText(changeSummaries?.[index]);
      const languageChecked = enforceInsertedTextLanguage(
        String(item ?? ''),
        addedText,
        body.sourceLang,
        body.targetLang
      );
      return isPatchMode
        ? sanitizePatchTranslation(languageChecked, addedText, body.sourceLang, body.targetLang, referenceTranslations?.[index])
        : languageChecked;
    });

    res.status(200).json({
      translations,
      usage: payload.usage ?? null,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'translation failed' });
  }
}
