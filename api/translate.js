const NVIDIA_CHAT_COMPLETIONS_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/v1/chat/completions';
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

function setCorsHeaders(req, res) {
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

const TRANSLATION_SKILL_PROMPT = [
  'You are a bilingual document translation engine for an Overleaf-like editor.',
  'Translate directly and faithfully. Do not summarize, expand, explain, or add commentary.',
  'Never polish, rewrite, or improve the language the user is actively editing unless the task is review-source. For translation/refinement tasks, only produce the corresponding text for the other language.',
  'For review-source requests, perform automatic grammar repair as a minimal local edit: fix only clear grammar, spelling, capitalization, punctuation, duplicated words, and obvious fluency errors in editedSource.',
  'Grammar repair must not change technical meaning, claims, terminology, tense unless grammatically required, citation placement, math, code, LaTeX commands, or document structure.',
  'Follow the source document style: preserve register, sentence rhythm, terminology, hedging, punctuation style, and academic tone.',
  'When previous target text is provided, perform a minimal-edit update on that previous target text: keep all still-correct wording unchanged and change only what is necessary to reflect the edited source.',
  'For refinement requests, use originalSource, editedSource, editSummary, and previousTarget together. The editedSource is the user-edited paragraph; previousTarget is the other side before this edit.',
  'For refinement requests, return the full updated target paragraph, but keep it as a minimal edit of previousTarget. Do not restyle previousTarget or make unrelated improvements.',
  'For review-source requests, revise editedSource in the same language according to reviewSuggestions and automatic grammar repair. Return the full updated source paragraph as a minimal edit. Do not translate it.',
  'For bilingual-sync requests, do both jobs in one response: sources contains the minimally grammar-repaired editedSource in the same language, and translations contains the corresponding minimal update for the opposite-language target.',
  'For bilingual-sync insertion items, translations must contain only the translated inserted passage, not previousTarget plus the insertion.',
  'When reviewSuggestions are provided, treat them as reviewer guidance for the selected source text, such as "sentence too long, split it" or "replace this term". Apply them only if they are relevant to editedSource, and still keep previousTarget changes minimal.',
  'Do not translate reviewSuggestions as document content. They are instructions, not text to insert.',
  'For patch requests, editedSource is only the newly inserted source fragment. Return only the translated fragment to insert on the other side, not the full paragraph and not previousTarget.',
  'For comment requests, translate only the selected quoted text or note text. Return the closest corresponding text span for highlighting. Do not return a whole paragraph unless the selected text itself is a whole paragraph.',
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
  'Return only valid JSON. For ordinary translation modes use exactly this shape: {"translations":["..."]}. For bilingual-sync use exactly this shape: {"sources":["..."],"translations":["..."]}.',
  'Do not wrap the JSON in Markdown code fences.',
  'Every returned array must have the same length and order as the input chunks.',
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

function normalizeProviderConfig(body) {
  const provider = ['nvidia', 'deepseek', 'custom'].includes(body.provider) ? body.provider : 'nvidia';
  const userApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const userBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const userModel = typeof body.model === 'string' ? body.model.trim() : '';

  if (provider === 'deepseek') {
    return {
      provider,
      label: 'DeepSeek',
      apiKey: userApiKey,
      url: userBaseUrl || process.env.DEEPSEEK_BASE_URL || DEEPSEEK_CHAT_COMPLETIONS_URL,
      model: userModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
  }

  if (provider === 'custom') {
    return {
      provider,
      label: 'Custom',
      apiKey: userApiKey,
      url: userBaseUrl,
      model: userModel,
    };
  }

  return {
    provider,
    label: 'NVIDIA',
    apiKey: userApiKey,
    url: userBaseUrl || process.env.NVIDIA_BASE_URL || NVIDIA_CHAT_COMPLETIONS_URL,
    model: userModel || process.env.NVIDIA_MODEL || DEFAULT_MODEL,
  };
}

function validateProviderConfig(config) {
  if (!config.apiKey) {
    throw new Error(`missing ${config.label} API key`);
  }
  if (!config.url || !/^https?:\/\//i.test(config.url)) {
    throw new Error(`invalid ${config.label} API URL`);
  }
  if (!config.model) {
    throw new Error(`missing ${config.label} model`);
  }
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

export function extractJson(content) {
  const text = String(content ?? '').trim();
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const objectMatch = unfenced.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    const arrayMatch = unfenced.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    throw new Error('model did not return JSON');
  }
}

function translationTextFromItem(item) {
  if (typeof item === 'string') return item;
  if (item === null || item === undefined) return '';
  if (typeof item !== 'object') return String(item);

  const preferredKeys = ['translation', 'translated', 'target', 'text', 'output', 'content'];
  for (const key of preferredKeys) {
    if (typeof item[key] === 'string') return item[key];
  }
  return null;
}

function sourceTextFromItem(item) {
  if (typeof item === 'string') return item;
  if (item === null || item === undefined) return '';
  if (typeof item !== 'object') return String(item);

  const preferredKeys = ['source', 'revisedSource', 'editedSource', 'sourceText', 'input', 'text', 'content'];
  for (const key of preferredKeys) {
    if (typeof item[key] === 'string') return item[key];
  }
  return null;
}

function normalizeTranslationArray(value, expectedLength) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(translationTextFromItem);
  if (normalized.some((item) => item === null)) return null;
  if (normalized.length === expectedLength) return normalized;
  if (normalized.length > expectedLength) return normalized.slice(0, expectedLength);
  return null;
}

function normalizeTranslationObject(value, expectedLength) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const numericIndexes = Array.from({ length: expectedLength }, (_, index) => [
    String(index),
    String(index + 1),
  ]);
  const normalized = numericIndexes.map(([zeroBased, oneBased]) => translationTextFromItem(value[zeroBased] ?? value[oneBased]));
  return normalized.some((item) => item === null) ? null : normalized;
}

export function normalizeModelTranslations(parsed, expectedLength) {
  if (expectedLength <= 0) return [];
  if (typeof parsed === 'string') return expectedLength === 1 ? [parsed] : null;
  if (Array.isArray(parsed)) return normalizeTranslationArray(parsed, expectedLength);
  if (!parsed || typeof parsed !== 'object') return null;

  const candidateArrays = [
    parsed.translations,
    parsed.translation,
    parsed.results,
    parsed.outputs,
    parsed.items,
    parsed.data,
  ];

  for (const candidate of candidateArrays) {
    if (typeof candidate === 'string' && expectedLength === 1) return [candidate];
    if (Array.isArray(candidate)) {
      const normalized = normalizeTranslationArray(candidate, expectedLength);
      if (normalized) return normalized;
    }
  }

  const objectCandidate = normalizeTranslationObject(parsed.translations, expectedLength)
    ?? normalizeTranslationObject(parsed, expectedLength);
  if (objectCandidate) return objectCandidate;

  for (const key of ['translation', 'translated', 'target', 'text', 'output', 'content']) {
    if (typeof parsed[key] === 'string' && expectedLength === 1) return [parsed[key]];
  }

  return null;
}

function normalizeSourceArray(value, expectedLength) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(sourceTextFromItem);
  if (normalized.some((item) => item === null)) return null;
  if (normalized.length === expectedLength) return normalized;
  if (normalized.length > expectedLength) return normalized.slice(0, expectedLength);
  return null;
}

function normalizeModelSources(parsed, expectedLength) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidates = [
    parsed.sources,
    parsed.revisedSources,
    parsed.sourceUpdates,
    parsed.editedSources,
    parsed.source,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeModelTranslations(candidate, expectedLength);
    if (normalized) return normalized;
  }

  const itemSources = normalizeSourceArray(parsed.items, expectedLength)
    ?? normalizeSourceArray(parsed.results, expectedLength)
    ?? normalizeSourceArray(parsed.outputs, expectedLength);
  if (itemSources) return itemSources;

  return null;
}

function describeTranslationShape(parsed) {
  if (Array.isArray(parsed)) return `array(${parsed.length})`;
  if (!parsed || typeof parsed !== 'object') return typeof parsed;
  return `object keys: ${Object.keys(parsed).slice(0, 8).join(', ') || 'none'}`;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).json({});
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const body = normalizeBody(req.body);
    const providerConfig = normalizeProviderConfig(body);
    validateProviderConfig(providerConfig);
    const chunks = body.chunks;
    validateChunks(chunks);
    const referenceTranslations = validateReferences(body.referenceTranslations, chunks);
    const originalChunks = validateOptionalStrings(body.originalChunks, chunks, 'originalChunks');
    const changeSummaries = validateOptionalStrings(body.changeSummaries, chunks, 'changeSummaries');
    const reviewSuggestions = validateOptionalStrings(body.reviewSuggestions, chunks, 'reviewSuggestions');
    const paragraphInsertions = Array.isArray(body.paragraphInsertions)
      ? body.paragraphInsertions.map(Boolean)
      : chunks.map(() => false);

    const sourceLanguage = safeLanguageName(body.sourceLang);
    const targetLanguage = safeLanguageName(body.targetLang);
    const format = body.format || 'plain text';
    const isPatchMode = body.mode === 'patch';
    const isRefineMode = body.mode === 'refine';
    const isReviewSourceMode = body.mode === 'review-source';
    const isBilingualSyncMode = body.mode === 'bilingual-sync';
    const isCommentMode = body.mode === 'comment';
    const mode = isPatchMode
      ? 'translate inserted fragments for local bilingual sync'
      : isRefineMode
        ? 'refine an edited passage'
        : isReviewSourceMode
          ? 'revise the source passage using review suggestions'
        : isBilingualSyncMode
          ? 'repair source grammar and update target translation in one pass'
        : isCommentMode
          ? 'translate selected comment text'
          : 'initial document translation';

    const userPrompt = [
      `Task: ${mode}.`,
      `Source language: ${sourceLanguage}.`,
      `Target language: ${targetLanguage}.`,
      `Document format: ${format}.`,
      isPatchMode
        ? 'Each editedSource is only the user-added fragment. Return only the translated fragment for each item.'
        : isReviewSourceMode
        ? 'Each editedSource is a source-language passage. Apply minimal automatic grammar repair and any relevant reviewSuggestions to that same passage. Return the revised passage in the same language.'
        : isBilingualSyncMode
        ? 'Each editedSource is a source-language passage. Return sources as the minimally grammar-repaired source passage and translations as the minimal target-language update.'
        : isCommentMode
        ? 'Each editedSource is selected comment text. Return the corresponding translated text span only.'
        : 'Translate each chunk independently. Keep paragraph breaks inside each chunk.',
      isPatchMode
        ? 'Use originalSource and previousTarget only as context for terminology and style. Do not return previousTarget or a full paragraph.'
        : isReviewSourceMode
        ? 'Do not translate. Do not use previousTarget. Preserve meaning, formatting, and style while applying only clear grammar fixes and requested review suggestions.'
        : isBilingualSyncMode
        ? 'Use originalSource, editedSource, editSummary, previousTarget, isParagraphInsertion, and reviewSuggestions. If isParagraphInsertion is true, translations must be only the translated inserted passage to append after previousTarget. Otherwise translations must be the full updated target paragraph as a minimal edit of previousTarget.'
        : isRefineMode
        ? 'Use originalSource, editedSource, editSummary, and previousTarget. Return the full updated target paragraph as a minimal edit of previousTarget.'
        : isCommentMode
        ? 'Keep the returned span short enough to highlight the matching selected words on the other side.'
        : referenceTranslations
        ? 'Previous target translations are provided. Update them minimally so they match the new source chunks.'
        : 'No previous target translations are provided. Produce a direct translation from scratch.',
      'Input JSON:',
      JSON.stringify(chunks.map((chunk, index) => ({
        originalSource: originalChunks?.[index] ?? null,
        editedSource: chunk,
        editSummary: changeSummaries?.[index] ?? null,
        previousTarget: referenceTranslations?.[index] ?? null,
        isParagraphInsertion: paragraphInsertions[index] ?? false,
        reviewSuggestions: reviewSuggestions?.[index] ?? null,
      }))),
    ].join('\n');

    const requestPayload = {
      model: providerConfig.model,
      messages: [
        { role: 'system', content: TRANSLATION_SKILL_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: Number(process.env.NVIDIA_MAX_TOKENS || 16384),
      temperature: Number(process.env.NVIDIA_TEMPERATURE || 0.1),
      top_p: 1,
      stream: false,
      response_format: { type: 'json_object' },
    };

    let response = await callChatCompletions(providerConfig.url, providerConfig.apiKey, requestPayload);
    let payload = await response.json().catch(() => ({}));
    const responseFormatRejected = !response.ok
      && response.status === 400
      && /response_format|json_object/i.test(JSON.stringify(payload));
    if (responseFormatRejected) {
      const { response_format: _responseFormat, ...payloadWithoutResponseFormat } = requestPayload;
      response = await callChatCompletions(providerConfig.url, providerConfig.apiKey, payloadWithoutResponseFormat);
      payload = await response.json().catch(() => ({}));
    }

    if (!response.ok) {
      const upstreamMessage = payload.error?.message || payload.message || payload.error || response.statusText || 'request failed';
      res.status(response.status).json({
        error: `${providerConfig.label} ${response.status} ${upstreamMessage}`,
      });
      return;
    }

    const content = payload.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    const normalizedTranslations = normalizeModelTranslations(parsed, chunks.length);
    if (!normalizedTranslations) {
      throw new Error(`model returned an invalid translations array (${describeTranslationShape(parsed)})`);
    }

    const normalizedSources = isBilingualSyncMode ? normalizeModelSources(parsed, chunks.length) : null;
    if (isBilingualSyncMode && !normalizedSources) {
      throw new Error(`model returned an invalid sources array (${describeTranslationShape(parsed)})`);
    }

    const translations = normalizedTranslations.map((item) => String(item ?? '').trim());

    const result = {
      translations,
      usage: payload.usage ?? null,
    };
    if (isBilingualSyncMode) {
      result.sources = normalizedSources.map((item) => String(item ?? ''));
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'translation failed' });
  }
}

function callChatCompletions(url, apiKey, payload) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
