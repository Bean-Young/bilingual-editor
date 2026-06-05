import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlignJustify,
  ArrowRightLeft,
  Check,
  ChevronDown,
  Cloud,
  Download,
  FileText,
  GripVertical,
  Highlighter,
  Languages,
  Link2,
  MessageSquarePlus,
  PanelRight,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import './styles.css';

const SAMPLE_SOURCE = String.raw`\section{Introduction}
Large language models have become a practical interface for scientific writing, data analysis, and code generation.

\subsection{Motivation}
Researchers still need a reliable way to keep the English source and Chinese translation aligned during revision.

This editor shows the whole source document and the whole Chinese version side by side. The middle divider can be dragged to resize both panes.

\begin{equation}
  p(y \mid x) = \prod_{t=1}^{T} p(y_t \mid y_{<t}, x)
\end{equation}`;

const ENABLE_IDLE_LLM_REFINEMENT = true;
const LLM_BACKOFF_MS = 30_000;
const CLOUD_FEATURES_ENABLED = false;
const LANGUAGES = [
  { code: 'auto', label: '智能识别', short: '自动' },
  { code: 'zh-CN', label: '中文简体', short: '中' },
  { code: 'zh-TW', label: '中文繁体', short: '中繁' },
  { code: 'en', label: '英语', short: '英' },
  { code: 'ja', label: '日语', short: '日' },
  { code: 'de', label: '德语', short: '德' },
  { code: 'fr', label: '法语', short: '法' },
  { code: 'es', label: '西班牙语', short: '西' },
  { code: 'ar', label: '阿拉伯语', short: '阿' },
];

const DEFAULT_SETTINGS = {
  accentHue: 214,
  autoDetect: true,
  sourceLang: 'auto',
  targetLang: 'auto',
  translationProvider: 'deepseek',
  translationApiKey: '',
  translationBaseUrl: '',
  translationModel: '',
};

const TRANSLATION_PROVIDERS = [
  {
    id: 'nvidia',
    label: 'NVIDIA / Kimi',
    model: 'moonshotai/kimi-k2.6',
    baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
  },
  {
    id: 'custom',
    label: '自定义兼容接口',
    model: '',
    baseUrl: '',
  },
];

const DEFAULT_DISPLAY_NAME = 'name';

const FORMAT_DETAILS = [
  { key: 'tex', name: 'LaTeX', extensions: '.tex', note: '论文、公式、引用' },
  { key: 'md', name: 'Markdown', extensions: '.md .markdown', note: '标题、列表、代码块' },
  { key: 'txt', name: 'Plain Text', extensions: '.txt', note: '纯文本草稿' },
  { key: 'docx', name: 'Microsoft Word', extensions: '.docx', note: 'Word 文档正文' },
  { key: 'rtf', name: 'Rich Text', extensions: '.rtf', note: '富文本源码' },
  { key: 'html', name: 'HTML', extensions: '.html .htm', note: '网页文本与标签' },
  { key: 'bib', name: 'BibTeX', extensions: '.bib', note: '参考文献条目' },
  { key: 'rst', name: 'reStructuredText', extensions: '.rst', note: '文档站点源码' },
  { key: 'table', name: 'CSV / TSV', extensions: '.csv .tsv', note: '表格型文本' },
  { key: 'data', name: 'JSON / YAML / XML', extensions: '.json .yaml .yml .xml', note: '结构化文本' },
];

const ACCEPTED_EXTENSIONS = FORMAT_DETAILS
  .flatMap((format) => format.extensions.split(' '))
  .join(',');

function inferSourceLanguage(text) {
  return languageSignal(text).language;
}

function languageSignal(text) {
  const cleaned = String(text ?? '')
    .replace(/\\begin\{[\s\S]*?\\end\{[^}]+}/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ');
  const cjkCount = (cleaned.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWords = cleaned.match(/[A-Za-z]{2,}/g) ?? [];

  if (cjkCount === 0) {
    return { language: 'en', cjkCount, latinWordCount: latinWords.length };
  }
  if (latinWords.length === 0) {
    return { language: 'zh-CN', cjkCount, latinWordCount: latinWords.length };
  }
  return {
    language: cjkCount >= Math.max(2, latinWords.length) ? 'zh-CN' : 'en',
    cjkCount,
    latinWordCount: latinWords.length,
  };
}

function inferTargetLanguage(text) {
  return oppositeLanguage(inferSourceLanguage(text));
}

function oppositeLanguage(language) {
  return language.startsWith('zh') ? 'en' : 'zh-CN';
}

function languageGroup(language) {
  if (language === 'auto') return 'auto';
  if (language.startsWith('zh')) return 'zh';
  return language;
}

function sameLanguageGroup(left, right) {
  return languageGroup(left) === languageGroup(right);
}

function resolveDirection(text, settings) {
  return resolveSideDirection(text, 'source', settings);
}

function resolveSideDirection(text, side, settings) {
  const activeSetting = side === 'source' ? settings.sourceLang : settings.targetLang;
  const passiveSetting = side === 'source' ? settings.targetLang : settings.sourceLang;
  const sourceLang = resolveInputLanguage(text, activeSetting);
  const targetLang = passiveSetting === 'auto' ? oppositeLanguage(sourceLang) : passiveSetting;

  return {
    sourceLang,
    targetLang,
  };
}

function resolveInputLanguage(text, configuredLanguage) {
  return configuredLanguage === 'auto' ? languageSignal(text).language : configuredLanguage;
}

async function requestLlmTranslations(chunks, direction, options = {}) {
  if (!chunks.length) return [];
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunks,
      sourceLang: direction.sourceLang,
      targetLang: direction.targetLang,
      format: options.format,
      mode: options.mode,
      referenceTranslations: options.referenceTranslations,
      originalChunks: options.originalChunks,
      changeSummaries: options.changeSummaries,
      reviewSuggestions: options.reviewSuggestions,
      paragraphInsertions: options.paragraphInsertions,
      provider: options.provider,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || '大模型翻译失败');
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(payload.translations) || payload.translations.length !== chunks.length) {
    throw new Error('大模型返回结果数量不匹配');
  }
  return payload.translations.map((item) => String(item ?? ''));
}

async function requestLlmBilingualSync(chunks, direction, options = {}) {
  if (!chunks.length) return { sources: [], translations: [] };
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunks,
      sourceLang: direction.sourceLang,
      targetLang: direction.targetLang,
      format: options.format,
      mode: 'bilingual-sync',
      referenceTranslations: options.referenceTranslations,
      originalChunks: options.originalChunks,
      changeSummaries: options.changeSummaries,
      reviewSuggestions: options.reviewSuggestions,
      paragraphInsertions: options.paragraphInsertions,
      provider: options.provider,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || '大模型同步失败');
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(payload.sources) || payload.sources.length !== chunks.length) {
    throw new Error('大模型返回源文数量不匹配');
  }
  if (!Array.isArray(payload.translations) || payload.translations.length !== chunks.length) {
    throw new Error('大模型返回译文数量不匹配');
  }
  return {
    sources: payload.sources.map((item) => String(item ?? '')),
    translations: payload.translations.map((item) => String(item ?? '')),
  };
}

async function requestLlmTranslationsWithRetry(chunks, direction, options = {}) {
  try {
    return await requestLlmTranslations(chunks, direction, options);
  } catch (error) {
    if (shouldRetryLlmRateLimit(error, options)) {
      const attempt = options.rateLimitAttempt ?? 0;
      const waitMs = llmRateLimitDelayMs(attempt);
      options.onRateLimit?.(attempt + 1, waitMs);
      await waitForLlmRetry(waitMs);
      return requestLlmTranslationsWithRetry(chunks, direction, {
        ...options,
        rateLimitAttempt: attempt + 1,
      });
    }

    if (!shouldRetryLlmFormatError(error)) {
      throw error;
    }
    if (chunks.length > 1) {
      const middle = Math.ceil(chunks.length / 2);
      const left = await requestLlmTranslationsWithRetry(chunks.slice(0, middle), direction, options);
      const right = await requestLlmTranslationsWithRetry(chunks.slice(middle), direction, options);
      return [...left, ...right];
    }

    if (options.retrySingle !== false) {
      await waitForLlmRetry(700);
      return requestLlmTranslations(chunks, direction, { ...options, retrySingle: false });
    }

    throw error;
  }
}

function shouldRetryLlmRateLimit(error, options) {
  const message = String(error?.message ?? '');
  if (options.mode !== 'import') return false;
  if (!(error?.status === 429 || /429|Too Many Requests/i.test(message))) return false;
  return (options.rateLimitAttempt ?? 0) < (options.maxRateLimitRetries ?? 6);
}

function llmRateLimitDelayMs(attempt) {
  return [15_000, 30_000, 60_000, 90_000, 120_000, 180_000][attempt] ?? 180_000;
}

function shouldRetryLlmFormatError(error) {
  const message = String(error?.message ?? '');
  if (/429|Too Many Requests|missing NVIDIA_API_KEY|401|403/i.test(message)) return false;
  return /数量不匹配|invalid translations array|did not return JSON|model returned|JSON/i.test(message);
}

function waitForLlmRetry(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function translateDocumentWithLlm(text, side, settings, format, mode = 'import', onProgress = null) {
  const direction = resolveSideDirection(text, side, settings);
  if (sameLanguageGroup(direction.sourceLang, direction.targetLang)) return null;

  const blocks = segmentSyncBlocks(text);
  const translatedBlocks = blocks.map((block) => ({ ...block }));
  const queue = blocks
    .flatMap((block, index) => splitBlockForLlm(block.text).map((part, partIndex, parts) => ({
      index,
      partIndex,
      partCount: parts.length,
      text: part.text,
      separator: part.separator,
    })))
    .filter((block) => block.text.trim() && !isProtectedMathBlock(block.text));
  const translatedParts = new Map();
  let completed = 0;

  let cursor = 0;
  while (cursor < queue.length) {
    const batch = [];
    let batchChars = 0;
    const maxBatchSize = mode === 'import' ? 1 : 6;
    const maxBatchChars = mode === 'import' ? 2200 : 7000;
    while (cursor < queue.length && batch.length < maxBatchSize) {
      const item = queue[cursor];
      if (batch.length && batchChars + item.text.length > maxBatchChars) break;
      batch.push(item);
      batchChars += item.text.length;
      cursor += 1;
    }

    const protectedBatch = batch.map((item) => maskInlineProtectedSyntax(item.text));
    const translations = await requestLlmTranslationsWithRetry(
      protectedBatch.map((item) => item.text),
      direction,
      {
        format,
        mode,
        ...translationServiceOptions(settings),
        onRateLimit: (attempt, waitMs) => {
          onProgress?.(completed, queue.length, `翻译服务限速，等待 ${Math.ceil(waitMs / 1000)} 秒后重试当前段（第 ${attempt} 次）`);
        },
      }
    );

    batch.forEach((item, batchIndex) => {
      const translated = restoreInlineProtectedSyntax(translations[batchIndex], protectedBatch[batchIndex].tokens);
      if (item.partCount <= 1) {
        translatedBlocks[item.index].text = translated;
        return;
      }
      const key = item.index;
      const parts = translatedParts.get(key) ?? Array(item.partCount).fill(null);
      parts[item.partIndex] = `${translated}${item.separator}`;
      translatedParts.set(key, parts);
    });
    completed += batch.length;
    onProgress?.(completed, queue.length);
    if (mode === 'import' && cursor < queue.length) {
      await waitForLlmRetry(2000);
    }
  }

  translatedParts.forEach((parts, index) => {
    if (parts.every((part) => part !== null)) {
      translatedBlocks[index].text = parts.join('').trim();
    }
  });

  return translatedBlocks.map((block) => `${block.text}${block.separator}`).join('');
}

function splitBlockForLlm(text, maxChars = 1800) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return [{ text: value, separator: '' }];

  const pieces = [];
  const pattern = /([^。！？.!?\n]+[。！？.!?]?\s*|\n+)/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    if (match[0]) pieces.push(match[0]);
  }
  if (!pieces.length) return splitHardByLength(value, maxChars);

  const chunks = [];
  let current = '';
  pieces.forEach((piece) => {
    if (current && current.length + piece.length > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current += piece;
    }
  });
  if (current) chunks.push(current);

  return chunks.flatMap((chunk) => (
    chunk.length > maxChars ? splitHardByLength(chunk, maxChars) : [{ text: chunk.trim(), separator: ' ' }]
  ));
}

function splitHardByLength(text, maxChars) {
  const chunks = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push({ text: text.slice(index, index + maxChars).trim(), separator: ' ' });
  }
  return chunks;
}

function isProtectedMathBlock(text) {
  const value = text.trim();
  return /^\\begin\{(?:equation|align|align\*|gather|gather\*|multline|multline\*)\}[\s\S]*\\end\{(?:equation|align|align\*|gather|gather\*|multline|multline\*)\}$/.test(value)
    || /^\$\$[\s\S]*\$\$$/.test(value)
    || /^\\\[[\s\S]*\\]$/.test(value);
}

function maskInlineProtectedSyntax(text) {
  const tokens = [];
  const masked = text.replace(/(\$[^$\n]+\$|\\\([^)]*\\\)|\\(?:cite|citep|citet|ref|eqref|autoref|cref|label)\*?(?:\[[^\]]*])?(?:\{[^}]*\})+)/g, (match) => {
    const token = `__PROTECTED_${tokens.length}__`;
    tokens.push(match);
    return token;
  });
  return { text: masked, tokens };
}

function restoreInlineProtectedSyntax(text, tokens) {
  return tokens.reduce((output, token, index) => output.replaceAll(`__PROTECTED_${index}__`, token), text);
}

function segmentSyncBlocks(text) {
  const value = String(text ?? '');
  if (!value) return [];
  const blocks = [];
  const separatorPattern = /\n\s*\n+/g;
  let lastIndex = 0;
  let match;

  while ((match = separatorPattern.exec(value)) !== null) {
    blocks.push({
      text: value.slice(lastIndex, match.index),
      separator: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  blocks.push({
    text: value.slice(lastIndex),
    separator: '',
  });

  return blocks.filter((block, index) => block.text || index === blocks.length - 1);
}

function mapUnchangedBlocks(previousBlocks, nextBlocks) {
  const rowCount = previousBlocks.length + 1;
  const colCount = nextBlocks.length + 1;
  const table = Array.from({ length: rowCount }, () => Array(colCount).fill(0));

  for (let row = previousBlocks.length - 1; row >= 0; row -= 1) {
    for (let col = nextBlocks.length - 1; col >= 0; col -= 1) {
      table[row][col] = previousBlocks[row].text === nextBlocks[col].text
        ? table[row + 1][col + 1] + 1
        : Math.max(table[row + 1][col], table[row][col + 1]);
    }
  }

  const mapping = new Map();
  let row = 0;
  let col = 0;
  while (row < previousBlocks.length && col < nextBlocks.length) {
    if (previousBlocks[row].text === nextBlocks[col].text) {
      mapping.set(col, row);
      row += 1;
      col += 1;
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      row += 1;
    } else {
      col += 1;
    }
  }

  return mapping;
}

function changedBlockIndexes(previousText, nextText) {
  if (previousText === nextText) return [];
  const previousBlocks = segmentSyncBlocks(previousText);
  const nextBlocks = segmentSyncBlocks(nextText);
  const unchangedMap = mapUnchangedBlocks(previousBlocks, nextBlocks);
  return nextBlocks
    .map((block, index) => ({ block, index }))
    .filter(({ block, index }) => block.text.trim() && !unchangedMap.has(index))
    .map(({ index }) => index);
}

function changedBlockJobs(previousActiveText, nextActiveText, previousPassiveText) {
  const previousActiveBlocks = segmentSyncBlocks(previousActiveText);
  const nextActiveBlocks = segmentSyncBlocks(nextActiveText);
  const previousPassiveBlocks = segmentSyncBlocks(previousPassiveText);
  const insertion = pureInsertionChange(previousActiveText, nextActiveText, previousActiveBlocks);

  if (insertion) {
    const activeBlock = previousActiveBlocks[insertion.blockIndex] ?? { text: '' };
    const passiveBlock = previousPassiveBlocks[insertion.blockIndex] ?? { text: '', separator: '\n\n' };
    return [{
      index: insertion.blockIndex,
      previousText: activeBlock.text,
      text: nextActiveBlocks[insertion.blockIndex]?.text ?? insertion.change.added,
      reference: passiveBlock.text,
      referenceSeparator: passiveBlock.separator,
      paragraphInsertion: insertion.paragraphInsertion,
      change: insertion.change,
    }];
  }

  const unchangedMap = mapUnchangedBlocks(previousActiveBlocks, nextActiveBlocks);

  return nextActiveBlocks
    .map((block, index) => {
      if (!block.text.trim() || unchangedMap.has(index)) return null;
      const previousBlock = previousActiveBlocks[index]?.text ?? '';
      const previousPassiveBlock = previousPassiveBlocks[index]?.text ?? '';
      const change = diffTextChange(previousBlock, block.text);
      return {
        index,
        previousText: previousBlock,
        text: block.text,
        reference: previousPassiveBlock,
        change,
      };
    })
    .filter(Boolean);
}

function commentGuidanceJobs(activeText, passiveText, quote, suggestion) {
  const activeBlocks = segmentSyncBlocks(activeText);
  const passiveBlocks = segmentSyncBlocks(passiveText);
  const normalizedQuote = normalizeHighlightQuote(quote).toLowerCase();
  if (!normalizedQuote) return [];

  const range = commentBlockRangeForQuote(activeBlocks, normalizedQuote);
  if (!range.length) return [];

  return range.map((index) => {
    const activeBlock = activeBlocks[index];
    const passiveBlock = passiveBlocks[index] ?? { text: '', separator: '\n\n' };
    return {
      index,
      previousText: activeBlock.text,
      text: activeBlock.text,
      reference: passiveBlock.text,
      referenceSeparator: passiveBlock.separator,
      paragraphInsertion: false,
      change: {
        prefix: activeBlock.text,
        suffix: '',
        removed: '',
        added: '',
        summary: `review suggestion for selected quote ${JSON.stringify(quote)}: ${JSON.stringify(suggestion)}`,
      },
    };
  });
}

function commentBlockRangeForQuote(blocks, normalizedQuote) {
  const directIndex = blocks.findIndex((block) =>
    normalizeHighlightQuote(block.text).toLowerCase().includes(normalizedQuote)
  );
  if (directIndex !== -1) return [directIndex];

  const spans = [];
  let cursor = 0;
  const joined = blocks
    .map((block, index) => {
      const text = normalizeHighlightQuote(block.text).toLowerCase();
      const start = cursor;
      const end = cursor + text.length;
      spans.push({ index, start, end, text });
      cursor = end + 1;
      return text;
    })
    .join(' ');
  const start = joined.indexOf(normalizedQuote);
  if (start === -1) return [];
  const end = start + normalizedQuote.length;
  return spans
    .filter((span) => span.text && span.end > start && span.start < end)
    .map((span) => span.index);
}

function mergeSyncJobs(existingJobs = [], guidanceJobs = []) {
  const byIndex = new Map();
  existingJobs.forEach((job) => {
    byIndex.set(job.index, job);
  });

  guidanceJobs.forEach((job) => {
    const existing = byIndex.get(job.index);
    if (!existing) {
      byIndex.set(job.index, job);
      return;
    }

    byIndex.set(job.index, {
      ...existing,
      referenceSeparator: existing.referenceSeparator ?? job.referenceSeparator,
      change: {
        ...existing.change,
        summary: [existing.change?.summary, job.change?.summary].filter(Boolean).join('\n'),
      },
    });
  });

  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

function commentSuggestionsForJob(comments, side, job) {
  return matchedCommentsForJob(comments, side, job)
    .map((comment) => {
      const entry = comment[side];
      return `Selected text: ${entry.quote}\nSuggestion: ${entry.text}`;
    })
    .join('\n\n');
}

function matchedCommentsForJob(comments, side, job) {
  if (!Array.isArray(comments) || !comments.length) return [];
  const normalizedTexts = [
    job.text,
    job.previousText,
    job.change?.added,
  ].map((item) => normalizeHighlightQuote(item).toLowerCase());

  return comments
    .filter((comment) => !comment.resolved)
    .filter((comment) => {
      const entry = comment[side];
      if (!entry?.quote || !entry?.text) return false;
      const quote = normalizeHighlightQuote(entry.quote).toLowerCase();
      return quote.length >= 2 && normalizedTexts
        .filter((text) => text.length >= 2)
        .some((text) => text.includes(quote) || quote.includes(text));
    });
}

function processedCommentIdsForJobs(comments, side, jobs) {
  const ids = new Set();
  jobs.forEach((job) => {
    matchedCommentsForJob(comments, side, job).forEach((comment) => ids.add(comment.id));
  });
  return ids;
}

function pendingSides(pending) {
  if (!pending) return {};
  if (pending.sides && typeof pending.sides === 'object') return pending.sides;
  if (pending.side) return { [pending.side]: pending };
  return {};
}

function pendingSideJobs(pending) {
  return Object.values(pendingSides(pending)).filter((item) => item?.jobs?.length);
}

function pendingSideJob(pending, side) {
  return pendingSides(pending)[side] ?? null;
}

function upsertPendingSide(pending, sideJob, comments) {
  return {
    sides: {
      ...pendingSides(pending),
      [sideJob.side]: sideJob,
    },
    comments,
  };
}

function diffTextChange(previousText, nextText) {
  let prefixLength = 0;
  const maxPrefix = Math.min(previousText.length, nextText.length);
  while (prefixLength < maxPrefix && previousText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffix = Math.min(previousText.length - prefixLength, nextText.length - prefixLength);
  while (
    suffixLength < maxSuffix
    && previousText[previousText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const removed = previousText.slice(prefixLength, previousText.length - suffixLength);
  const added = nextText.slice(prefixLength, nextText.length - suffixLength);
  return {
    prefix: previousText.slice(0, prefixLength),
    suffix: previousText.slice(previousText.length - suffixLength),
    removed,
    added,
    summary: `removed: ${JSON.stringify(removed)}; added: ${JSON.stringify(added)}`,
  };
}

function replaceSyncBlocks(text, replacements) {
  const blocks = segmentSyncBlocks(text);
  return blocks
    .map((block, index) => `${replacements.has(index) ? replacements.get(index) : block.text}${block.separator}`)
    .join('');
}

function applySyncReplacements(text, replacements, rendered, format) {
  if (!replacements.size) return text;
  return rendered ? replaceRenderedBlocks(text, replacements, format) : replaceSyncBlocks(text, replacements);
}

function activeJobIndexes(sideJobs, side) {
  const job = sideJobs.find((item) => item.side === side);
  return new Set(job?.jobs?.map((item) => item.index) ?? []);
}

async function translateChangedBlocksWithLlm(jobs, side, settings, format, comments = []) {
  const direction = resolveSideDirection(jobs[0]?.text ?? '', side, settings);
  if (sameLanguageGroup(direction.sourceLang, direction.targetLang)) return new Map();

  const workItems = jobs
    .filter((item) => item.text.trim() && !isProtectedMathBlock(item.text))
    .map((item) => ({ ...item, llmText: item.text }));
  const replacements = new Map();

  let cursor = 0;
  while (cursor < workItems.length) {
    const batch = [workItems[cursor]];
    cursor += 1;

    const protectedBatch = batch.map((item) => maskInlineProtectedSyntax(item.llmText));
    const translations = await requestLlmTranslations(
      protectedBatch.map((item) => item.text),
      direction,
      {
        format,
        mode: 'refine',
        ...translationServiceOptions(settings),
        referenceTranslations: batch.map((item) => item.reference),
        originalChunks: batch.map((item) => item.previousText),
        changeSummaries: batch.map((item) => item.change.summary),
        reviewSuggestions: batch.map((item) => commentSuggestionsForJob(comments, side, item)),
      }
    );

    batch.forEach((item, batchIndex) => {
      const translatedBlock = restoreInlineProtectedSyntax(translations[batchIndex], protectedBatch[batchIndex].tokens).trim();
      if (!translatedBlock) return;
      if (item.paragraphInsertion) {
        replacements.set(item.index, insertParagraphPatch(item.reference, item.referenceSeparator, translatedBlock));
        return;
      }
      replacements.set(item.index, translatedBlock);
    });
  }

  return replacements;
}

async function reviseActiveBlocksWithLlm(jobs, side, settings, format, comments = []) {
  const activeSetting = side === 'source' ? settings.sourceLang : settings.targetLang;
  const activeLanguage = resolveInputLanguage(jobs[0]?.text ?? '', activeSetting);
  const direction = { sourceLang: activeLanguage, targetLang: activeLanguage };
  const workItems = jobs
    .filter((item) => item.text.trim() && !isProtectedMathBlock(item.text))
    .map((item) => ({ ...item, llmText: item.text }));
  const replacements = new Map();

  let cursor = 0;
  while (cursor < workItems.length) {
    const batch = [workItems[cursor]];
    cursor += 1;

    const protectedBatch = batch.map((item) => maskInlineProtectedSyntax(item.llmText));
    const translations = await requestLlmTranslations(
      protectedBatch.map((item) => item.text),
      direction,
      {
        format,
        mode: 'review-source',
        ...translationServiceOptions(settings),
        originalChunks: batch.map((item) => item.previousText),
        changeSummaries: batch.map((item) => item.change.summary),
        reviewSuggestions: batch.map((item) => commentSuggestionsForJob(comments, side, item)),
      }
    );

    batch.forEach((item, batchIndex) => {
      const revisedBlock = restoreInlineProtectedSyntax(translations[batchIndex], protectedBatch[batchIndex].tokens).trim();
      if (revisedBlock) replacements.set(item.index, revisedBlock);
    });
  }

  return replacements;
}

async function syncChangedBlocksWithLlm(jobs, side, settings, format, comments = []) {
  const direction = resolveSideDirection(jobs[0]?.text ?? '', side, settings);
  if (sameLanguageGroup(direction.sourceLang, direction.targetLang)) {
    return { activeReplacements: new Map(), passiveReplacements: new Map() };
  }

  const workItems = jobs
    .filter((item) => item.text.trim() && !isProtectedMathBlock(item.text))
    .map((item) => ({ ...item, llmText: item.text }));
  const activeReplacements = new Map();
  const passiveReplacements = new Map();

  let cursor = 0;
  while (cursor < workItems.length) {
    const batch = [workItems[cursor]];
    cursor += 1;

    const protectedBatch = batch.map((item) => maskInlineProtectedSyntax(item.llmText));
    const result = await requestLlmBilingualSync(
      protectedBatch.map((item) => item.text),
      direction,
      {
        format,
        ...translationServiceOptions(settings),
        referenceTranslations: batch.map((item) => item.reference),
        originalChunks: batch.map((item) => item.previousText),
        changeSummaries: batch.map((item) => item.change.summary),
        reviewSuggestions: batch.map((item) => commentSuggestionsForJob(comments, side, item)),
        paragraphInsertions: batch.map((item) => Boolean(item.paragraphInsertion)),
      }
    );

    batch.forEach((item, batchIndex) => {
      const sourceBlock = restoreInlineProtectedSyntax(result.sources[batchIndex], protectedBatch[batchIndex].tokens).trim();
      const translatedBlock = restoreInlineProtectedSyntax(result.translations[batchIndex], protectedBatch[batchIndex].tokens).trim();
      if (sourceBlock && !item.paragraphInsertion) {
        activeReplacements.set(item.index, sourceBlock);
      }
      if (!translatedBlock) return;
      if (item.paragraphInsertion) {
        passiveReplacements.set(item.index, insertParagraphPatch(item.reference, item.referenceSeparator, translatedBlock));
        return;
      }
      passiveReplacements.set(item.index, translatedBlock);
    });
  }

  return { activeReplacements, passiveReplacements };
}

function jobsWithActiveRevisions(jobs, activeReplacements) {
  if (!activeReplacements.size) return jobs;
  return jobs.map((job) => {
    const revisedText = activeReplacements.get(job.index);
    if (!revisedText) return job;
    return {
      ...job,
      previousText: job.text,
      text: revisedText,
      change: diffTextChange(job.text, revisedText),
    };
  });
}

function changedRenderedBlockJobs(previousActiveText, nextActiveText, previousPassiveText) {
  const previousActiveBlocks = keyedRenderedBlocks(previousActiveText);
  const nextActiveBlocks = keyedRenderedBlocks(nextActiveText);
  const previousPassiveBlocks = keyedRenderedBlocks(previousPassiveText);
  const previousByKey = new Map(previousActiveBlocks.map((block) => [block.key, block]));
  const passiveByKey = new Map(previousPassiveBlocks.map((block) => [block.key, block]));
  const jobs = [];
  let insertedRun = [];

  function flushInsertedRun(anchorBlock) {
    if (!insertedRun.length) return;
    const passiveBlock = anchorBlock ? passiveByKey.get(anchorBlock.key) : previousPassiveBlocks[0];
    if (!passiveBlock) {
      insertedRun = [];
      return;
    }
    const insertedText = insertedRun.map((block) => block.text).join('\n\n');
    jobs.push({
      index: passiveBlock.index,
      previousText: '',
      text: insertedText,
      reference: passiveBlock.text,
      referenceSeparator: '\n\n',
      paragraphInsertion: true,
      change: {
        prefix: '',
        suffix: '',
        removed: '',
        added: insertedText,
        summary: `inserted rendered block(s): ${JSON.stringify(insertedText)}`,
      },
    });
    insertedRun = [];
  }

  let lastMatchedBlock = null;
  nextActiveBlocks.forEach((block) => {
    const previousBlock = previousByKey.get(block.key);
    if (!previousBlock) {
      if (block.text.trim() && block.type !== 'equation') insertedRun.push(block);
      return;
    }

    flushInsertedRun(lastMatchedBlock ?? previousBlock);
    lastMatchedBlock = previousBlock;
    if (previousBlock.text === block.text) return;
    const passiveBlock = passiveByKey.get(block.key);
    if (!passiveBlock) return;
    jobs.push({
      index: passiveBlock.index,
      previousText: previousBlock.text,
      text: block.text,
      reference: passiveBlock.text,
      referenceSeparator: '\n\n',
      paragraphInsertion: false,
      change: diffTextChange(previousBlock.text, block.text),
    });
  });

  flushInsertedRun(lastMatchedBlock);
  return mergeRenderedInsertionJobs(jobs);
}

function mergeRenderedInsertionJobs(jobs) {
  const merged = [];
  jobs.forEach((job) => {
    const previous = merged[merged.length - 1];
    if (job.paragraphInsertion && previous?.paragraphInsertion && previous.index === job.index) {
      previous.text = [previous.text, job.text].filter(Boolean).join('\n\n');
      previous.change.added = [previous.change.added, job.change.added].filter(Boolean).join('\n\n');
      previous.change.summary = `inserted rendered block(s): ${JSON.stringify(previous.change.added)}`;
      return;
    }
    merged.push({ ...job, change: { ...job.change } });
  });
  return merged;
}

function keyedRenderedBlocks(text) {
  const counters = new Map();
  let h1 = 0;
  let h2 = 0;
  return renderBlocks(text).map((block, index) => {
    if (block.type === 'h1') {
      h1 += 1;
      h2 = 0;
      return { ...block, index, key: `h1:${h1}` };
    }
    if (block.type === 'h2') {
      h2 += 1;
      return { ...block, index, key: `h1:${h1}|h2:${h2}` };
    }
    const scope = `h1:${h1}|h2:${h2}|${block.type}`;
    const count = (counters.get(scope) ?? 0) + 1;
    counters.set(scope, count);
    return { ...block, index, key: `${scope}:${count}` };
  });
}

function replaceRenderedBlocks(text, replacements, format) {
  return renderBlocks(text)
    .map((block, index) => serializeRenderedBlock(block.type, replacements.has(index) ? replacements.get(index) : block.text, format))
    .filter(Boolean)
    .join('\n\n');
}

function appendLocalPatch(text, patch) {
  if (!text.trim()) return patch;
  const left = text.trim();
  const right = patch.trim();
  const noSpace = /\s$/.test(text)
    || /^[,.;:!?，。；：！？、]/.test(right)
    || (/[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff]/.test(right));
  const spacer = noSpace ? '' : ' ';
  return `${text}${spacer}${patch}`;
}

function insertParagraphPatch(text, separator, patch) {
  const cleanPatch = patch.trim();
  if (!text.trim()) return cleanPatch;
  const blockSeparator = separator && separator.trim() === '' ? separator : '\n\n';
  return `${text}${blockSeparator}${cleanPatch}`;
}

function pureInsertionChange(previousText, nextText, previousBlocks = segmentSyncBlocks(previousText)) {
  if (previousText === nextText) return null;
  const change = diffTextChange(previousText, nextText);
  if (!change.added.trim() || change.removed.trim()) return null;
  const insertionOffset = change.prefix.length;
  return {
    change,
    blockIndex: blockIndexAtOffset(previousText, previousBlocks, insertionOffset),
    paragraphInsertion: /^\s*\n\s*\n/.test(change.added) || /\n\s*\n\s*$/.test(change.added),
  };
}

function blockIndexAtOffset(text, blocks, offset) {
  if (!blocks.length) return 0;
  let cursor = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const blockEnd = cursor + block.text.length;
    const separatorEnd = blockEnd + block.separator.length;
    if (offset <= separatorEnd) return index;
    cursor = separatorEnd;
  }
  return blocks.length - 1;
}

function wouldDamagePassiveText(candidate, previousPassiveText, activeText, side, settings) {
  if (side !== 'target') return false;
  const direction = resolveSideDirection(activeText, side, settings);
  if (direction.targetLang !== 'en') return false;

  const previousLetters = (previousPassiveText.match(/[A-Za-z]/g) ?? []).length;
  if (previousLetters < 40) return false;

  const candidateLetters = (candidate.match(/[A-Za-z]/g) ?? []).length;
  const candidateWords = candidate.match(/[A-Za-z]{2,}/g) ?? [];
  const punctuationFragments = (candidate.match(/(^|\n)\s*[,.;:!?]/g) ?? []).length;

  return candidateLetters < previousLetters * 0.45
    || candidateWords.length < 4
    || punctuationFragments >= 2;
}

function resolvePaneLanguages(doc, settings) {
  const sourceDirection = resolveSideDirection(doc.sourceText, 'source', settings);
  const targetDirection = resolveSideDirection(doc.targetText, 'target', settings);

  if (doc.lastEdited === 'target') {
    return {
      source: settings.sourceLang === 'auto' ? targetDirection.targetLang : settings.sourceLang,
      target: settings.targetLang === 'auto' ? targetDirection.sourceLang : settings.targetLang,
    };
  }

  return {
    source: settings.sourceLang === 'auto'
      ? (doc.sourceText.trim() ? inferSourceLanguage(doc.sourceText) : sourceDirection.sourceLang)
      : settings.sourceLang,
    target: settings.targetLang === 'auto' ? sourceDirection.targetLang : settings.targetLang,
  };
}

function languageLabel(code) {
  return LANGUAGES.find((item) => item.code === code)?.label ?? code;
}

function languageShort(code) {
  return LANGUAGES.find((item) => item.code === code)?.short ?? code;
}

function makePairedCommentText() {
  return '';
}

function themeVars(hue) {
  return {
    '--accent-hue': hue,
    '--accent': `hsl(${hue} 78% 45%)`,
    '--accent-strong': `hsl(${hue} 82% 35%)`,
    '--accent-soft': `hsl(${hue} 52% 94%)`,
    '--accent-border': `hsl(${hue} 44% 74%)`,
  };
}

function detectFormat(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'docx') return 'docx';
  if (ext === 'tex') return 'tex';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'rtf') return 'rtf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'bib') return 'bib';
  if (ext === 'rst') return 'rst';
  if (ext === 'csv' || ext === 'tsv') return 'table';
  if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'xml') return 'data';
  return 'txt';
}

function formatInfo(key) {
  return FORMAT_DETAILS.find((format) => format.key === key) ?? FORMAT_DETAILS.find((format) => format.key === 'txt');
}

function createInitialState() {
  return {
    fileName: 'sample-paper.tex',
    format: 'tex',
    savedAt: null,
    sourceText: SAMPLE_SOURCE,
    targetText: '',
    lastEdited: null,
    comments: [],
  };
}

function consumeLocalResetRequest() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('reset') || window.__bilingualEditorResetConsumed) return false;
    window.__bilingualEditorResetConsumed = true;
    [
      'bilingual-editor:last-document',
      'bilingual-editor:recent-documents',
    ].forEach((key) => localStorage.removeItem(key));
    params.delete('reset');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    return true;
  } catch {
    return false;
  }
}

function loadInitialState() {
  try {
    if (consumeLocalResetRequest()) return createInitialState();
    const raw = localStorage.getItem('bilingual-editor:last-document');
    if (!raw) return createInitialState();
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return createInitialState();
    return {
      ...createInitialState(),
      fileName: saved.fileName || 'sample-paper.tex',
      format: saved.format || detectFormat(saved.fileName || 'sample-paper.tex'),
      savedAt: saved.savedAt ?? null,
      sourceText: String(saved.sourceText ?? ''),
      targetText: String(saved.targetText ?? ''),
      lastEdited: saved.lastEdited ?? null,
      comments: Array.isArray(saved.comments) ? saved.comments : [],
    };
  } catch {
    return createInitialState();
  }
}

function classNames(...names) {
  return names.filter(Boolean).join(' ');
}

function isSupportedLanguage(code) {
  return LANGUAGES.some((language) => language.code === code);
}

function normalizeTranslationSettings(settings) {
  const provider = TRANSLATION_PROVIDERS.some((item) => item.id === settings.translationProvider)
    ? settings.translationProvider
    : DEFAULT_SETTINGS.translationProvider;
  const preset = TRANSLATION_PROVIDERS.find((item) => item.id === provider) ?? TRANSLATION_PROVIDERS[0];
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    translationProvider: provider,
    translationApiKey: String(settings.translationApiKey ?? ''),
    translationBaseUrl: String(settings.translationBaseUrl || preset.baseUrl || ''),
    translationModel: String(settings.translationModel || preset.model || ''),
  };
}

function loadLocalSettings() {
  try {
    const raw = localStorage.getItem('bilingual-editor:settings');
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeTranslationSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLocalSettings(settings) {
  localStorage.setItem('bilingual-editor:settings', JSON.stringify(normalizeTranslationSettings(settings)));
}

function translationServiceOptions(settings) {
  const normalized = normalizeTranslationSettings(settings);
  return {
    provider: normalized.translationProvider,
    apiKey: normalized.translationApiKey.trim(),
    baseUrl: normalized.translationBaseUrl.trim(),
    model: normalized.translationModel.trim(),
  };
}

function translationProviderLabel(settings) {
  const normalized = normalizeTranslationSettings(settings);
  return TRANSLATION_PROVIDERS.find((item) => item.id === normalized.translationProvider)?.label ?? '翻译服务';
}

function settingsFromProfile(profile, fallbackSettings) {
  const sourceLang = isSupportedLanguage(profile.default_source_lang) ? profile.default_source_lang : fallbackSettings.sourceLang;
  const targetLang = isSupportedLanguage(profile.default_target_lang) ? profile.default_target_lang : fallbackSettings.targetLang;
  const profileHue = Number(profile.theme_hue);
  return normalizeTranslationSettings({
    ...fallbackSettings,
    accentHue: Number.isFinite(profileHue) ? profileHue : fallbackSettings.accentHue,
    sourceLang,
    targetLang,
    autoDetect: sourceLang === 'auto' && targetLang === 'auto',
  });
}

function defaultProfilePayload(user, settings) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.user_metadata?.display_name || DEFAULT_DISPLAY_NAME,
    theme_hue: settings.accentHue,
    default_source_lang: settings.sourceLang,
    default_target_lang: settings.targetLang,
  };
}

function documentFromRow(row) {
  return {
    fileName: row.file_name,
    format: row.format,
    savedAt: row.updated_at ? new Date(row.updated_at).toLocaleString('zh-CN', { hour12: false }) : null,
    sourceText: row.source_text ?? '',
    targetText: row.target_text ?? '',
    lastEdited: row.last_edited ?? null,
    comments: Array.isArray(row.comments) ? row.comments : [],
  };
}

function documentPayload(doc, userId, includeOwner = true) {
  const payload = {
    title: doc.fileName || 'Untitled document',
    file_name: doc.fileName || 'untitled.tex',
    format: doc.format || 'txt',
    source_text: doc.sourceText || '',
    target_text: doc.targetText || '',
    comments: doc.comments || [],
    last_edited: doc.lastEdited,
  };
  if (includeOwner) payload.owner_id = userId;
  return payload;
}

function documentListTitle(row) {
  return row.title || row.file_name || 'Untitled document';
}

function cloneComments(comments) {
  try {
    return JSON.parse(JSON.stringify(Array.isArray(comments) ? comments : []));
  } catch {
    return [];
  }
}

function documentHistoryKey(item) {
  return [
    item.fileName || '',
    item.format || '',
    item.sourceText?.length ?? 0,
    item.sourceText?.slice(0, 120) ?? '',
  ].join('::');
}

function documentHistorySnapshot(item) {
  return {
    id: crypto.randomUUID(),
    fileName: item.fileName || 'untitled.txt',
    format: item.format || 'txt',
    savedAt: item.savedAt ?? null,
    sourceText: item.sourceText ?? '',
    targetText: item.targetText ?? '',
    lastEdited: item.lastEdited ?? null,
    comments: cloneComments(item.comments),
    rememberedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  };
}

function normalizePresenceUsers(presenceState) {
  const users = Object.values(presenceState)
    .flat()
    .filter((item) => item?.userId && item?.email);
  return [...new Map(users.map((item) => [item.userId, item])).values()]
    .sort((a, b) => a.email.localeCompare(b.email));
}

function App() {
  const [doc, setDoc] = useState(loadInitialState);
  const [settings, setSettings] = useState(loadLocalSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSide, setActiveSide] = useState('source');
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [syncMode, setSyncMode] = useState('auto');
  const [realtimePreview, setRealtimePreview] = useState({ source: null, target: null });
  const [status, setStatus] = useState(() => {
    try {
      return localStorage.getItem('bilingual-editor:last-document')
        ? '已恢复浏览器本地保存'
        : '已加载示例文档';
    } catch {
      return '已加载示例文档';
    }
  });
  const [leftWidth, setLeftWidth] = useState(50);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentDocs, setRecentDocs] = useState([]);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [selectedCommentText, setSelectedCommentText] = useState({ side: null, text: '', rect: null });
  const [draftComment, setDraftComment] = useState(null);
  const [authReady, setAuthReady] = useState(true);
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '', displayName: '' });
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [cloudDocs, setCloudDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('本地模式');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [profile, setProfile] = useState(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const fileRef = useRef(null);
  const splitAreaRef = useRef(null);
  const saveTimerRef = useRef(null);
  const profileTimerRef = useRef(null);
  const llmTimerRef = useRef(null);
  const llmRequestRef = useRef(0);
  const pendingLlmRefinementRef = useRef(null);
  const editSessionRef = useRef(null);
  const initialTranslationRef = useRef(null);
  const initialTranslationInFlightRef = useRef(false);
  const remoteUpdateRef = useRef(false);
  const realtimeMirrorRef = useRef({ source: {}, target: {} });
  const llmBackoffUntilRef = useRef(0);

  const stats = useMemo(() => {
    const unresolved = doc.comments.filter((item) => !item.resolved).length;
    return {
      sourceChars: doc.sourceText.length,
      targetChars: doc.targetText.length,
      unresolved,
    };
  }, [doc]);
  const paneLanguages = useMemo(() => resolvePaneLanguages(doc, settings), [doc, settings]);

  const visibleComments = doc.comments;
  const visibleRecentDocs = useMemo(() => {
    const currentKey = documentHistoryKey(doc);
    return recentDocs.filter((item) => documentHistoryKey(item) !== currentKey);
  }, [doc, recentDocs]);
  const currentUser = session?.user ?? null;
  const cloudEnabled = CLOUD_FEATURES_ENABLED && isSupabaseConfigured && Boolean(currentUser);
  const userDisplayName = profile?.display_name || currentUser?.user_metadata?.display_name || DEFAULT_DISPLAY_NAME;
  const displaySourceText = realtimePreview.source ?? doc.sourceText;
  const displayTargetText = realtimePreview.target ?? doc.targetText;

  function pushUndoSnapshot(snapshot = doc) {
    setUndoSnapshot(snapshot);
  }

  function rememberRecentDocument(item = doc) {
    if (!item?.sourceText?.trim() && !item?.targetText?.trim()) return;
    const snapshot = documentHistorySnapshot(item);
    const snapshotKey = documentHistoryKey(snapshot);
    setRecentDocs((current) => [
      snapshot,
      ...current.filter((existing) => documentHistoryKey(existing) !== snapshotKey),
    ].slice(0, 16));
  }

  function openRecentDocument(documentId) {
    const nextDoc = recentDocs.find((item) => item.id === documentId);
    if (!nextDoc) return;
    pushUndoSnapshot();
    rememberRecentDocument(doc);
    clearPendingSync();
    setRecentDocs((current) => current.filter((item) => item.id !== documentId));
    setSelectedDocId(null);
    setDoc({
      fileName: nextDoc.fileName,
      format: nextDoc.format,
      savedAt: nextDoc.savedAt,
      sourceText: nextDoc.sourceText,
      targetText: nextDoc.targetText,
      lastEdited: nextDoc.lastEdited,
      comments: cloneComments(nextDoc.comments),
    });
    setActiveSide('source');
    setStatus(`已打开之前文件 ${nextDoc.fileName}`);
  }

  function updateCommentSelection(side, text, rect = null) {
    const cleanText = text.trim();
    setSelectedCommentText(cleanText ? { side, text: cleanText, rect } : { side: null, text: '', rect: null });
  }

  useEffect(() => {
    let pointerStart = null;

    function syncSelection() {
      const focusedSelection = getFocusedTextareaSelection();
      if (focusedSelection) {
        setSelectedCommentText(focusedSelection);
        setActiveSide(focusedSelection.side);
        return;
      }

      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!text || !selection?.rangeCount) {
        setSelectedCommentText({ side: null, text: '', rect: null });
        return;
      }

      const anchor = selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : selection.anchorNode;
      const pane = anchor?.closest?.('.document-pane');
      const side = pane?.dataset.paneSide;

      if (!side) {
        setSelectedCommentText({ side: null, text: '', rect: null });
        return;
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      setSelectedCommentText({
        side,
        text,
        rect: getFloatingCommentPosition(rect, paneRect),
      });
      setActiveSide(side);
    }

    function syncAfterInteraction(event) {
      if ((event.type === 'mouseup' || event.type === 'pointerup') && isPlainPointerClick(event, pointerStart)) {
        setSelectedCommentText({ side: null, text: '', rect: null });
        return;
      }
      window.setTimeout(syncSelection, 30);
    }

    function clearOnOutsideClick(event) {
      pointerStart = { x: event.clientX, y: event.clientY };
      if (!event.target.closest?.('.floating-comment-button')) {
        setSelectedCommentText({ side: null, text: '', rect: null });
      }
    }

    document.addEventListener('selectionchange', syncAfterInteraction);
    document.addEventListener('mouseup', syncAfterInteraction);
    document.addEventListener('pointerup', syncAfterInteraction);
    document.addEventListener('keyup', syncAfterInteraction);
    document.addEventListener('mousedown', clearOnOutsideClick);
    return () => {
      document.removeEventListener('selectionchange', syncAfterInteraction);
      document.removeEventListener('mouseup', syncAfterInteraction);
      document.removeEventListener('pointerup', syncAfterInteraction);
      document.removeEventListener('keyup', syncAfterInteraction);
      document.removeEventListener('mousedown', clearOnOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!CLOUD_FEATURES_ENABLED || !isSupabaseConfigured) return undefined;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
      setCloudStatus(data.session ? '已连接云端' : '等待登录');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      setCloudStatus(nextSession ? '已连接云端' : '等待登录');
      if (!nextSession) {
        setCloudDocs([]);
        setSelectedDocId(null);
        setOnlineUsers([]);
        setProfile(null);
        setDisplayNameDraft('');
        setProfileStatus('');
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!cloudEnabled) return;
    loadCloudDocuments();
  }, [cloudEnabled]);

  useEffect(() => {
    if (!cloudEnabled) {
      setProfile(null);
      setDisplayNameDraft('');
      setProfileStatus('');
      return;
    }

    loadUserProfile();
  }, [cloudEnabled, currentUser?.id]);

  useEffect(() => {
    if (!cloudEnabled || !selectedDocId) return undefined;

    const channel = supabase
      .channel(`document:${selectedDocId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'documents', filter: `id=eq.${selectedDocId}` },
        ({ new: row }) => {
          remoteUpdateRef.current = true;
          setDoc(documentFromRow(row));
          setCloudStatus(`收到协作者更新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
        }
      )
      .on('presence', { event: 'sync' }, () => {
        setOnlineUsers(normalizePresenceUsers(channel.presenceState()));
      })
      .subscribe(async (realtimeStatus) => {
        if (realtimeStatus === 'SUBSCRIBED') {
          await channel.track({
            userId: currentUser.id,
            email: currentUser.email,
            displayName: userDisplayName,
            onlineAt: new Date().toISOString(),
          });
        }
      });

    return () => {
      setOnlineUsers([]);
      supabase.removeChannel(channel);
    };
  }, [cloudEnabled, selectedDocId, currentUser?.id, currentUser?.email, userDisplayName]);

  useEffect(() => {
    if (!cloudEnabled || !selectedDocId) return undefined;
    if (remoteUpdateRef.current) {
      remoteUpdateRef.current = false;
      return undefined;
    }

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      persistCloudDocument(doc, selectedDocId);
    }, 900);

    return () => window.clearTimeout(saveTimerRef.current);
  }, [cloudEnabled, selectedDocId, doc.sourceText, doc.targetText, doc.fileName, doc.format, doc.lastEdited, doc.comments]);

  useEffect(() => () => {
    window.clearTimeout(profileTimerRef.current);
    window.clearTimeout(llmTimerRef.current);
  }, []);

  useEffect(() => {
    if (selectedDocId) return;
    if (doc.savedAt) return;
    if (doc.fileName !== 'sample-paper.tex' || doc.targetText.trim()) return;
    const key = `${doc.fileName}:${doc.sourceText}:${settings.translationProvider}:${settings.translationApiKey ? 'key' : 'no-key'}:${settings.translationModel}:${settings.translationBaseUrl}`;
    if (initialTranslationRef.current === key) return;
    initialTranslationRef.current = key;
    translateInitialDocument(doc);
  }, [
    selectedDocId,
    doc.fileName,
    doc.sourceText,
    doc.targetText,
    settings.sourceLang,
    settings.targetLang,
    settings.translationProvider,
    settings.translationApiKey,
    settings.translationModel,
    settings.translationBaseUrl,
  ]);

  async function translateInitialDocument(baseDoc, options = {}) {
    clearPendingSync();
    const requestId = llmRequestRef.current + 1;
    llmRequestRef.current = requestId;
    const service = translationServiceOptions(settings);
    const serviceLabel = translationProviderLabel(settings);
    if (!service.apiKey) {
      setStatus(`请先在设置里输入 ${serviceLabel} API Key，再开始翻译`);
      return baseDoc;
    }
    initialTranslationInFlightRef.current = true;
    setStatus(`正在用 ${serviceLabel} 分段翻译 ${baseDoc.fileName}`);

    let finalDoc = baseDoc;
    try {
      const llmTargetText = await translateDocumentWithLlm(
        baseDoc.sourceText,
        'source',
        settings,
        baseDoc.format,
        'import',
        (done, total, detail = '') => {
          if (llmRequestRef.current === requestId) {
            setStatus(detail || `正在用 ${serviceLabel} 分段翻译 ${baseDoc.fileName}：${done}/${total}`);
          }
        }
      );
      finalDoc = {
        ...baseDoc,
        targetText: llmTargetText ?? '',
        comments: baseDoc.comments,
        lastEdited: null,
      };
      if (llmRequestRef.current !== requestId) return null;
      setDoc((current) => {
        if (current.fileName !== baseDoc.fileName || current.sourceText !== baseDoc.sourceText) return current;
        return finalDoc;
      });
      setStatus(`已用 ${serviceLabel} 完成 ${baseDoc.fileName} 分段翻译`);
    } catch (error) {
      finalDoc = {
        ...baseDoc,
        targetText: baseDoc.targetText ?? '',
        comments: baseDoc.comments,
        lastEdited: null,
      };
      if (llmRequestRef.current !== requestId) return null;
      setDoc((current) => {
        if (current.fileName !== baseDoc.fileName || current.sourceText !== baseDoc.sourceText) return current;
        return finalDoc;
      });
      setStatus(`${serviceLabel} 初次翻译失败，未写入译文：${error.message}`);
    } finally {
      initialTranslationInFlightRef.current = false;
    }

    if (options.createCloudAfter && cloudEnabled) {
      await createCloudDocument(finalDoc);
    }
    return finalDoc;
  }

  function clearPendingSync() {
    realtimeMirrorRef.current = { source: {}, target: {} };
    pendingLlmRefinementRef.current = null;
    editSessionRef.current = null;
    window.clearTimeout(llmTimerRef.current);
    setRealtimePreview({ source: null, target: null });
  }

  async function translateCommentsForSide(comments, side, format) {
    if (!Array.isArray(comments) || !comments.length) return [];
    const otherSide = side === 'source' ? 'target' : 'source';
    const nextComments = comments.map((comment) => {
      const active = comment[side] ?? legacyCommentSide(comment, side);
      const existingOther = comment[otherSide] ?? legacyCommentSide(comment, otherSide);
      return {
        ...comment,
        [side]: active,
        [otherSide]: {
          ...existingOther,
        },
      };
    });

    const pieces = [];
    nextComments.forEach((comment, index) => {
      const active = comment[side] ?? {};
      if (active.quote) pieces.push({ index, field: 'quote', text: active.quote });
      if (active.text) pieces.push({ index, field: 'text', text: active.text });
    });
    if (!pieces.length) return nextComments;

    const direction = resolveSideDirection(pieces.map((item) => item.text).join('\n'), side, settings);
    if (sameLanguageGroup(direction.sourceLang, direction.targetLang)) return nextComments;

    for (const piece of pieces) {
      const protectedPiece = maskInlineProtectedSyntax(piece.text);
      const [translation] = await requestLlmTranslations(
        [protectedPiece.text],
        direction,
        { format, mode: 'comment', ...translationServiceOptions(settings) }
      );
      const restored = restoreInlineProtectedSyntax(translation, protectedPiece.tokens).trim();
      if (restored) nextComments[piece.index][otherSide][piece.field] = restored;
    }

    return nextComments;
  }

  function pairCommentsLocally(comments, side) {
    if (!Array.isArray(comments) || !comments.length) return [];
    const otherSide = side === 'source' ? 'target' : 'source';
    return comments.map((comment) => {
      const active = comment[side] ?? legacyCommentSide(comment, side);
      const existingOther = comment[otherSide] ?? legacyCommentSide(comment, otherSide);
      return {
        ...comment,
        [side]: active,
        [otherSide]: {
          ...existingOther,
          quote: active.quote ? makePairedCommentText(active.quote, side, 'quote') || existingOther.quote : existingOther.quote,
          text: active.text ? makePairedCommentText(active.text, side, 'text') || existingOther.text : existingOther.text,
        },
      };
    });
  }

  function recordPendingSync(side, activeText, passiveText, previousActiveText, format, nextSettings = settings, options = {}) {
    if (!ENABLE_IDLE_LLM_REFINEMENT) return;
    const rendered = Boolean(options.rendered);
    const existingPending = pendingSideJob(pendingLlmRefinementRef.current, side);
    const existingSession = editSessionRef.current;
    const sameSession = existingSession
      && existingSession.side === side
      && existingSession.rendered === rendered
      && existingSession.format === format;
    const session = sameSession
      ? existingSession
      : {
        side,
        rendered,
        format,
        baseActiveText: existingPending?.baseActiveText ?? previousActiveText,
        basePassiveText: existingPending?.passiveText ?? passiveText,
      };

    session.activeText = activeText;
    session.settings = { ...nextSettings };
    editSessionRef.current = session;

    const jobs = rendered
      ? changedRenderedBlockJobs(session.baseActiveText, activeText, session.basePassiveText)
      : changedBlockJobs(session.baseActiveText, activeText, session.basePassiveText);
    if (!jobs.length) return;

    const sideJob = {
      side,
      activeText,
      baseActiveText: session.baseActiveText,
      passiveText: session.basePassiveText,
      jobs,
      format,
      settings: { ...nextSettings },
      rendered,
      comments: doc.comments,
    };
    pendingLlmRefinementRef.current = upsertPendingSide(
      pendingLlmRefinementRef.current,
      sideJob,
      doc.comments
    );
    window.clearTimeout(llmTimerRef.current);
    if (syncMode === 'auto') {
      llmTimerRef.current = window.setTimeout(() => runQueuedLlmRefinement({ manual: false }), 3000);
      setStatus('已记录修改，停止 3 秒后同步');
    } else {
      setStatus('已记录修改，点击同步后更新另一侧');
    }
  }

  function recordPendingCommentGuidance(side, quote, text, comment) {
    if (!ENABLE_IDLE_LLM_REFINEMENT) return false;
    const existing = pendingLlmRefinementRef.current;
    const existingSide = pendingSideJob(existing, side);
    const canMergeExisting = existing
      && existingSide
      && existingSide.format === doc.format
      && !existingSide.rendered;
    const activeText = canMergeExisting
      ? existingSide.activeText
      : (side === 'source' ? doc.sourceText : doc.targetText);
    const passiveText = canMergeExisting
      ? existingSide.passiveText
      : (side === 'source' ? doc.targetText : doc.sourceText);
    const jobs = commentGuidanceJobs(activeText, passiveText, quote, text);
    if (!jobs.length) {
      setStatus('已添加修改建议；未找到对应段落');
      return false;
    }

    const comments = [
      comment,
      ...(existingSide?.comments ?? existing?.comments ?? doc.comments),
    ];
    const mergedJobs = canMergeExisting ? mergeSyncJobs(existingSide.jobs, jobs) : jobs;
    const sideJob = {
      side,
      activeText,
      baseActiveText: canMergeExisting ? existingSide.baseActiveText : activeText,
      passiveText,
      jobs: mergedJobs,
      format: doc.format,
      settings: { ...settings },
      rendered: false,
      comments,
    };
    pendingLlmRefinementRef.current = upsertPendingSide(existing, sideJob, comments);
    editSessionRef.current = {
      side,
      rendered: false,
      format: doc.format,
      baseActiveText: canMergeExisting ? existingSide.baseActiveText : activeText,
      basePassiveText: passiveText,
      activeText,
      settings: { ...settings },
    };
    window.clearTimeout(llmTimerRef.current);
    if (syncMode === 'auto') {
      llmTimerRef.current = window.setTimeout(() => runQueuedLlmRefinement({ manual: false }), 3000);
    }
    return true;
  }

  async function runQueuedLlmRefinement({ manual = false } = {}) {
    if (manual) {
      window.clearTimeout(llmTimerRef.current);
    }
    const pending = pendingLlmRefinementRef.current;
    const sideJobs = pendingSideJobs(pending);
    if (!sideJobs.length) {
      if (manual) setStatus('没有待同步的修改');
      return;
    }
    if (initialTranslationInFlightRef.current) {
      if (manual) setStatus('正在分段翻译，完成后再同步修改');
      return;
    }
    if (Date.now() < llmBackoffUntilRef.current) {
      if (manual) setStatus('翻译服务刚刚限速，稍后再同步');
      return;
    }
    const primarySettings = sideJobs[0].settings;
    if (!translationServiceOptions(primarySettings).apiKey) {
      setSettingsOpen(true);
      setStatus(`已记录修改，请先在设置里输入 ${translationProviderLabel(primarySettings)} API Key`);
      return;
    }
    pendingLlmRefinementRef.current = null;
    const requestId = llmRequestRef.current + 1;
    llmRequestRef.current = requestId;
    const serviceLabel = translationProviderLabel(primarySettings);
    setStatus(`正在用 ${serviceLabel} 更新双语段落...`);

    try {
      const processedCommentIds = new Set();
      sideJobs.forEach((sideJob) => {
        processedCommentIdsForJobs(sideJob.comments ?? pending?.comments ?? doc.comments, sideJob.side, sideJob.jobs)
          .forEach((id) => processedCommentIds.add(id));
      });
      const activeIndexes = {
        source: activeJobIndexes(sideJobs, 'source'),
        target: activeJobIndexes(sideJobs, 'target'),
      };
      const syncResults = await Promise.all(sideJobs.map(async (sideJob) => ({
        job: sideJob,
        result: await syncChangedBlocksWithLlm(
          sideJob.jobs,
          sideJob.side,
          sideJob.settings,
          sideJob.format,
          sideJob.comments ?? pending?.comments ?? doc.comments
        ),
      })));
      const hasReplacements = syncResults.some(({ result }) =>
        result.activeReplacements.size || result.passiveReplacements.size
      );
      if (llmRequestRef.current !== requestId || !hasReplacements) return;

      setDoc((current) => {
        let nextSourceText = current.sourceText;
        let nextTargetText = current.targetText;
        let anyApplied = false;

        syncResults.forEach(({ job: sideJob, result }) => {
          const currentActiveText = sideJob.side === 'source' ? nextSourceText : nextTargetText;
          const comparableActiveText = sideJob.rendered
            ? serializeTextForRenderedEditing(currentActiveText, current.format)
            : currentActiveText;
          if (comparableActiveText !== sideJob.activeText && comparableActiveText !== sideJob.baseActiveText) {
            return;
          }

          const nextActiveText = result.activeReplacements.size
            ? applySyncReplacements(sideJob.activeText, result.activeReplacements, sideJob.rendered, current.format)
            : sideJob.activeText;
          const passiveSide = sideJob.side === 'source' ? 'target' : 'source';
          const passiveReplacements = new Map(
            Array.from(result.passiveReplacements.entries())
              .filter(([index]) => !activeIndexes[passiveSide].has(index))
          );

          if (sideJob.side === 'source') {
            nextSourceText = nextActiveText;
            nextTargetText = applySyncReplacements(nextTargetText, passiveReplacements, sideJob.rendered, current.format);
          } else {
            nextTargetText = nextActiveText;
            nextSourceText = applySyncReplacements(nextSourceText, passiveReplacements, sideJob.rendered, current.format);
          }
          anyApplied = true;
        });

        if (!anyApplied) return current;
        return {
          ...current,
          savedAt: null,
          sourceText: nextSourceText,
          targetText: nextTargetText,
          comments: processedCommentIds.size
            ? current.comments.filter((comment) => !processedCommentIds.has(comment.id))
            : current.comments,
        };
      });
      sideJobs.forEach((sideJob) => {
        realtimeMirrorRef.current[sideJob.side] = {};
      });
      editSessionRef.current = null;
      setRealtimePreview({ source: null, target: null });
      setStatus(processedCommentIds.size
        ? `已用 ${serviceLabel} 更新双语段落，并移除已处理批注`
        : `已用 ${serviceLabel} 更新双语段落`);
    } catch (error) {
      pendingLlmRefinementRef.current = pending;
      if (/429|Too Many Requests/i.test(error.message || '')) {
        llmBackoffUntilRef.current = Date.now() + LLM_BACKOFF_MS;
      }
      setStatus(`${serviceLabel} 暂不可用，已保留待同步修改：${error.message}`);
    }
  }

  async function loadUserProfile() {
    if (!cloudEnabled || !currentUser) return;
    setProfileStatus('正在加载用户资料...');
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,display_name,theme_hue,default_source_lang,default_target_lang,updated_at')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (error) {
      setProfileStatus(`用户资料加载失败：${error.message}`);
      return;
    }

    let nextProfile = data;
    if (!nextProfile) {
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .upsert(defaultProfilePayload(currentUser, settings), { onConflict: 'id' })
        .select('id,email,display_name,theme_hue,default_source_lang,default_target_lang,updated_at')
        .single();

      if (createError) {
        setProfileStatus(`用户资料创建失败：${createError.message}`);
        return;
      }
      nextProfile = created;
    }

    setProfile(nextProfile);
    setDisplayNameDraft(nextProfile.display_name || DEFAULT_DISPLAY_NAME);
    setSettings((current) => settingsFromProfile(nextProfile, current));
    setProfileStatus('用户资料已同步');
  }

  function scheduleProfileSave(nextSettings = settings) {
    if (!cloudEnabled || !currentUser) return;
    window.clearTimeout(profileTimerRef.current);
    profileTimerRef.current = window.setTimeout(async () => {
      const payload = {
        id: currentUser.id,
        email: currentUser.email,
        display_name: profile?.display_name || currentUser.user_metadata?.display_name || DEFAULT_DISPLAY_NAME,
        theme_hue: nextSettings.accentHue,
        default_source_lang: nextSettings.sourceLang,
        default_target_lang: nextSettings.targetLang,
      };
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select('id,email,display_name,theme_hue,default_source_lang,default_target_lang,updated_at')
        .single();

      if (error) {
        setProfileStatus(`设置保存失败：${error.message}`);
        return;
      }

      setProfile(data);
      setProfileStatus('设置已保存到账号');
    }, 500);
  }

  async function saveDisplayName() {
    if (!cloudEnabled || !currentUser) return;
    const cleanName = displayNameDraft.trim() || DEFAULT_DISPLAY_NAME;
    setProfileStatus('正在保存用户资料...');
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: currentUser.id,
        email: currentUser.email,
        display_name: cleanName,
        theme_hue: settings.accentHue,
        default_source_lang: settings.sourceLang,
        default_target_lang: settings.targetLang,
      }, { onConflict: 'id' })
      .select('id,email,display_name,theme_hue,default_source_lang,default_target_lang,updated_at')
      .single();

    if (error) {
      setProfileStatus(`用户资料保存失败：${error.message}`);
      return;
    }

    setProfile(data);
    setDisplayNameDraft(data.display_name || cleanName);
    setProfileStatus('用户资料已保存');
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError('');
    setAuthNotice('');
    if (authSubmitting) return;
    const email = authForm.email.trim();
    const password = authForm.password;
    if (!email || !password) {
      setAuthError('请输入邮箱和密码');
      return;
    }

    setAuthSubmitting(true);
    try {
      let result = authMode === 'signup'
        ? await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: authForm.displayName.trim() || DEFAULT_DISPLAY_NAME } },
        })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setAuthError(result.error.message);
        return;
      }

      if (authMode === 'signup' && !result.data.session) {
        result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) {
          const needsEmailConfirm = result.error.message.toLowerCase().includes('email not confirmed');
          setAuthError(needsEmailConfirm
            ? '注册成功，但 Supabase 仍开启邮箱验证，暂时不能直接登录。请关闭 Authentication > Providers > Email > Confirm email。'
            : `注册成功，但自动登录失败：${result.error.message}`);
          return;
        }
      }

      if (!result.data.session) {
        setAuthError('登录没有返回会话，请刷新后重试。');
        return;
      }

      setSession(result.data.session);
      const nextMessage = authMode === 'signup' ? '注册成功，已进入编辑器' : '登录成功';
      setCloudStatus(nextMessage);
      setAuthNotice(nextMessage);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    rememberRecentDocument(doc);
    clearPendingSync();
    setDoc(createInitialState());
    setStatus('已退出登录');
  }

  async function loadCloudDocuments(selectFirst = true) {
    if (!cloudEnabled) return;
    setCloudLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('id,title,file_name,format,owner_id,updated_at,created_at')
      .order('updated_at', { ascending: false });

    setCloudLoading(false);
    if (error) {
      setCloudStatus(`云端加载失败：${error.message}`);
      return;
    }

    setCloudDocs(data ?? []);
    if (selectFirst && !selectedDocId && data?.length) {
      await openCloudDocument(data[0].id);
    }
  }

  async function openCloudDocument(documentId) {
    setCloudLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();
    setCloudLoading(false);

    if (error) {
      setCloudStatus(`打开失败：${error.message}`);
      return;
    }

    remoteUpdateRef.current = true;
    rememberRecentDocument(doc);
    clearPendingSync();
    setSelectedDocId(data.id);
    setDoc(documentFromRow(data));
    setStatus(`已打开云端文档 ${data.file_name}`);
    setCloudStatus('云端文档已同步');
  }

  async function createCloudDocumentFromCurrent() {
    await createCloudDocument(doc);
  }

  async function createCloudDocument(nextDoc) {
    if (!cloudEnabled) return;
    setCloudLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .insert(documentPayload({ ...nextDoc, fileName: nextDoc.fileName || 'untitled.tex' }, currentUser.id))
      .select('*')
      .single();
    setCloudLoading(false);

    if (error) {
      setCloudStatus(`创建失败：${error.message}`);
      return;
    }

    setSelectedDocId(data.id);
    setCloudDocs((items) => [data, ...items.filter((item) => item.id !== data.id)]);
    setCloudStatus('已创建云端文档');
    setStatus('已保存到云端');
  }

  async function persistCloudDocument(nextDoc = doc, documentId = selectedDocId) {
    if (!cloudEnabled || !documentId) return;
    setCloudStatus('正在保存...');
    const { data, error } = await supabase
      .from('documents')
      .update(documentPayload(nextDoc, currentUser.id, false))
      .eq('id', documentId)
      .select('id,title,file_name,format,owner_id,updated_at,created_at')
      .single();

    if (error) {
      setCloudStatus(`保存失败：${error.message}`);
      return;
    }

    setCloudDocs((items) => [data, ...items.filter((item) => item.id !== data.id)]);
    setCloudStatus(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  }

  async function inviteCollaborator(event) {
    event.preventDefault();
    if (!selectedDocId || !shareEmail.trim()) return;
    setShareStatus('正在邀请...');
    const { error } = await supabase.rpc('invite_collaborator_by_email', {
      target_document_id: selectedDocId,
      target_email: shareEmail.trim(),
    });

    if (error) {
      setShareStatus(`邀请失败：${error.message}`);
      return;
    }

    setShareEmail('');
    setShareStatus('已添加，可编辑');
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const format = detectFormat(file.name);
    setStatus(`正在读取 ${file.name}`);
    let rawText = '';

    if (format === 'docx') {
      const mammoth = await import('mammoth/mammoth.browser');
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      rawText = result.value;
    } else {
      rawText = await file.text();
    }

    const nextDoc = {
      fileName: file.name,
      format,
      savedAt: null,
      sourceText: rawText,
      targetText: '',
      lastEdited: null,
      comments: [],
    };

    pushUndoSnapshot();
    rememberRecentDocument(doc);
    clearPendingSync();
    setDoc(nextDoc);
    setActiveSide('source');
    await translateInitialDocument(nextDoc, { createCloudAfter: cloudEnabled });
    event.target.value = '';
  }

  function updateText(side, value, options = {}) {
    const activeBaseText = side === 'source' ? doc.sourceText : doc.targetText;
    const passiveBaseText = side === 'source' ? doc.targetText : doc.sourceText;
    const previousActiveText = options.rendered ? serializeTextForRenderedEditing(activeBaseText, doc.format) : activeBaseText;
    const previousPassiveText = options.rendered ? serializeTextForRenderedEditing(passiveBaseText, doc.format) : passiveBaseText;
    if (options.rendered) {
      setRealtimePreview((current) => ({ ...current, source: null, target: null }));
    }
    if (options.pushUndo !== false) {
      pushUndoSnapshot();
    }
    setDoc((current) => {
      if (side === 'source') {
        return {
          ...current,
          savedAt: null,
          sourceText: value,
          lastEdited: 'source',
        };
      }
      return {
        ...current,
        savedAt: null,
        targetText: value,
        lastEdited: 'target',
      };
    });
    recordPendingSync(side, value, previousPassiveText, previousActiveText, doc.format, settings, { rendered: options.rendered });
    setActiveSide(side);
  }

  function previewText(side, value, options = {}) {
    const activeBaseText = side === 'source' ? doc.sourceText : doc.targetText;
    const passiveBaseText = side === 'source' ? doc.targetText : doc.sourceText;
    const previousActiveText = options.rendered ? serializeTextForRenderedEditing(activeBaseText, doc.format) : activeBaseText;
    const previousPassiveText = options.rendered ? serializeTextForRenderedEditing(passiveBaseText, doc.format) : passiveBaseText;
    if (options.rendered) {
      recordPendingSync(side, value, previousPassiveText, previousActiveText, doc.format, settings, { rendered: options.rendered });
      setActiveSide(side);
      return;
    }
    setDoc((current) => {
      if (side === 'source') {
        return {
          ...current,
          savedAt: null,
          sourceText: options.rendered ? current.sourceText : value,
          lastEdited: 'source',
        };
      }
      return {
        ...current,
        savedAt: null,
        targetText: options.rendered ? current.targetText : value,
        lastEdited: 'target',
      };
    });
    recordPendingSync(side, value, previousPassiveText, previousActiveText, doc.format, settings, { rendered: options.rendered });
    setActiveSide(side);
  }

  function startCommentDraft(side = activeSide) {
    const selectedText = selectedCommentText.side === side ? selectedCommentText.text : '';
    if (!selectedText) {
      setStatus('请先选中文本再添加批注');
      return;
    }
    const quote = selectedText;
    setActiveSide(side);
    setCommentsOpen(true);
    setDraftComment({ side, quote, text: '' });
    setSelectedCommentText({ side: null, text: '', rect: null });
    setStatus('正在添加批注');
  }

  function saveCommentDraft() {
    const text = draftComment?.text?.trim();
    if (!draftComment || !text) {
      setStatus('请输入批注内容');
      return;
    }
    const side = draftComment.side;
    const quote = draftComment.quote;
    const nextComment = {
      id: crypto.randomUUID(),
      source: side === 'source' ? { text, quote } : null,
      target: side === 'target' ? { text, quote } : null,
      resolved: false,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    };
    pushUndoSnapshot();
    setDoc((current) => ({
      ...current,
      comments: [
        nextComment,
        ...current.comments,
      ],
    }));
    const willSync = recordPendingCommentGuidance(side, quote, text, nextComment);
    setDraftComment(null);
    if (willSync) {
      setStatus(syncMode === 'auto' ? '已添加修改建议，停止 3 秒后同步' : '已添加修改建议，点击同步后处理');
    }
  }

  function cancelCommentDraft() {
    setDraftComment(null);
    setStatus('已取消批注');
  }

  function toggleComment(commentId) {
    pushUndoSnapshot();
    setDoc((current) => ({
      ...current,
      comments: current.comments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: !comment.resolved } : comment
      ),
    }));
  }

  function removeComment(commentId) {
    pushUndoSnapshot();
    setDoc((current) => ({
      ...current,
      comments: current.comments.filter((comment) => comment.id !== commentId),
    }));
  }

  function applySettings(nextSettings) {
    const normalizedSettings = normalizeTranslationSettings({
      ...nextSettings,
      autoDetect: nextSettings.sourceLang === 'auto' && nextSettings.targetLang === 'auto',
    });
    setSettings(normalizedSettings);
    saveLocalSettings(normalizedSettings);
    scheduleProfileSave(normalizedSettings);
    setStatus('已更新设置');
  }

  function updateLanguage(side, value) {
    applySettings({
      ...settings,
      [side === 'source' ? 'sourceLang' : 'targetLang']: value,
    });
  }

  function swapLanguages() {
    const nextSettings = {
      ...settings,
      sourceLang: settings.targetLang,
      targetLang: settings.sourceLang,
    };
    const normalizedSettings = normalizeTranslationSettings({
      ...nextSettings,
      autoDetect: nextSettings.sourceLang === 'auto' && nextSettings.targetLang === 'auto',
    });
    setSettings(normalizedSettings);
    saveLocalSettings(normalizedSettings);
    scheduleProfileSave(normalizedSettings);
    setStatus('已互换翻译语言');
  }

  function toggleSyncMode() {
    setSyncMode((current) => {
      const next = current === 'auto' ? 'manual' : 'auto';
      window.clearTimeout(llmTimerRef.current);
      if (next === 'auto' && pendingLlmRefinementRef.current) {
        llmTimerRef.current = window.setTimeout(() => runQueuedLlmRefinement({ manual: false }), 3000);
        setStatus('自动同步已开启，待同步修改将在 3 秒后更新');
      } else {
        setStatus(next === 'auto' ? '自动同步已开启' : '自动同步已暂停，可点击同步按钮手动更新');
      }
      return next;
    });
  }

  async function saveSnapshot() {
    if (cloudEnabled) {
      if (selectedDocId) {
        await persistCloudDocument(doc, selectedDocId);
        setStatus('已保存到云端');
      } else {
        await createCloudDocumentFromCurrent();
      }
      return;
    }

    const savedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    const snapshot = { ...doc, savedAt };
    localStorage.setItem('bilingual-editor:last-document', JSON.stringify(snapshot));
    setDoc(snapshot);
    setStatus(`已保存到浏览器本地缓存：${savedAt}`);
  }

  function undoLastChange() {
    if (!undoSnapshot) {
      setStatus('没有可撤销的修改');
      return;
    }
    setDoc(undoSnapshot);
    setUndoSnapshot(null);
    setStatus('已撤销上一步修改');
  }

  function exportText(side) {
    const content = side === 'source' ? doc.sourceText : doc.targetText;
    const suffix = side === 'source' ? 'en' : 'zh';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, doc.fileName.replace(/\.[^.]+$/, '') + `.${suffix}.${doc.format === 'docx' ? 'txt' : doc.format}`);
  }

  async function exportDocx(side) {
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const content = side === 'source' ? doc.sourceText : doc.targetText;
    const paragraphs = content.split(/\n{2,}/).flatMap((chunk) => [
      new Paragraph({
        children: [new TextRun(chunk.trim())],
      }),
      new Paragraph(''),
    ]);
    const file = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
    saveAs(file, doc.fileName.replace(/\.[^.]+$/, '') + (side === 'source' ? '.en.docx' : '.zh.docx'));
  }

  function startResize(event) {
    event.preventDefault();
    const area = splitAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();

    function move(pointerEvent) {
      const next = ((pointerEvent.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(75, Math.max(25, next)));
    }

    function stop() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  const outline = extractOutline(doc.sourceText);
  const searchState = useMemo(
    () => getSearchState(displaySourceText, displayTargetText, search),
    [displaySourceText, displayTargetText, search]
  );
  const matchCount = searchState.query ? searchState.totalMatches : null;
  const sourceCommentHighlights = getCommentHighlights(visibleComments, 'source', draftComment, displaySourceText, displayTargetText);
  const targetCommentHighlights = getCommentHighlights(visibleComments, 'target', draftComment, displaySourceText, displayTargetText);

  if (!authReady) {
    return <div className="loading-screen">正在连接云端...</div>;
  }

  if (CLOUD_FEATURES_ENABLED && isSupabaseConfigured && !session) {
    return (
      <AuthScreen
        mode={authMode}
        form={authForm}
        error={authError}
        notice={authNotice}
        submitting={authSubmitting}
        onModeChange={setAuthMode}
        onFormChange={setAuthForm}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <div className={classNames('app-shell', sidebarCollapsed && 'sidebar-collapsed')} style={themeVars(settings.accentHue)}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Languages size={20} /></div>
          <div>
            <strong>双语稿件台</strong>
          </div>
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(true)} title="收起侧栏" aria-label="收起侧栏">
            <ChevronDown size={15} />
          </button>
        </div>

        <div className="cloud-box">
          {cloudEnabled ? (
            <>
              <div className="cloud-user">
                <UserRound size={16} />
                <div>
                  <strong>{userDisplayName}</strong>
                  <span>{currentUser.email}</span>
                  <em>{profileStatus || cloudStatus}</em>
                </div>
              </div>
              <button className="secondary-action" onClick={signOut}>退出登录</button>
            </>
          ) : (
            <>
              <div className="cloud-user">
                <Cloud size={16} />
                <div>
                  <strong>本地模式</strong>
                </div>
              </div>
            </>
          )}
        </div>

        <button className="primary-action" onClick={() => fileRef.current?.click()}>
          <Upload size={18} />
          上传文档
        </button>
        <input
          ref={fileRef}
          className="hidden-input"
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleFileChange}
        />

        <div className="format-strip" aria-label="支持的可编辑格式">
          <strong>支持格式</strong>
          <div>
            {ACCEPTED_EXTENSIONS.split(',').map((extension) => (
              <span key={extension}>{extension}</span>
            ))}
          </div>
        </div>

        <div className="side-section">
          <div className="section-title">当前文件</div>
          <div className="file-card">
            <FileText size={18} />
            <div>
              <strong>{doc.fileName}</strong>
              <span>{formatInfo(doc.format).name} · {formatInfo(doc.format).note}</span>
            </div>
          </div>
        </div>

        {visibleRecentDocs.length > 0 && (
          <div className="side-section">
            <div className="section-title">之前文件</div>
            <div className="recent-file-list">
              {visibleRecentDocs.map((item) => (
                <button key={item.id} onClick={() => openRecentDocument(item.id)}>
                  <FileText size={14} />
                  <span>
                    <strong>{item.fileName}</strong>
                    <em>{formatInfo(item.format).name} · {item.rememberedAt}</em>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {cloudEnabled && (
          <div className="side-section">
            <div className="section-title action-title">
              <span>云文档</span>
              <button onClick={createCloudDocumentFromCurrent} disabled={cloudLoading} title="把当前内容保存为新云文档">
                <Plus size={14} />
              </button>
            </div>
            <div className="cloud-doc-list">
              {cloudDocs.length === 0 && <span className="empty-line">暂无云文档</span>}
              {cloudDocs.map((item) => (
                <button
                  key={item.id}
                  className={item.id === selectedDocId ? 'active' : ''}
                  onClick={() => openCloudDocument(item.id)}
                >
                  <strong>{documentListTitle(item)}</strong>
                  <span>{new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {cloudEnabled && selectedDocId && (
          <div className="side-section">
            <div className="section-title">协作共享</div>
            <form className="share-form" onSubmit={inviteCollaborator}>
              <label>
                <span>协作者邮箱</span>
                <input
                  value={shareEmail}
                  onChange={(event) => setShareEmail(event.target.value)}
                  type="email"
                  placeholder="name@example.com"
                />
              </label>
              <button type="submit">
                <Users size={14} />
                邀请协作
              </button>
              {shareStatus && <em>{shareStatus}</em>}
            </form>
            <div className="presence-list">
              <strong>当前在线</strong>
              {onlineUsers.length === 0 && <span>等待协作者加入</span>}
              {onlineUsers.map((user) => (
                <span key={user.userId}>{user.displayName || DEFAULT_DISPLAY_NAME}</span>
              ))}
            </div>
          </div>
        )}

        <div className="side-section">
          <div className="section-title">文档结构</div>
          <div className="outline-list">
            {outline.length === 0 && <span>未识别标题</span>}
            {outline.map((item) => (
              <button
                key={item.id}
                className={item.level === 2 ? 'nested' : ''}
                onClick={() => scrollToHeading(item.id)}
              >
                {item.text}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {sidebarCollapsed && (
        <button className="sidebar-expand" onClick={() => setSidebarCollapsed(false)} title="展开侧栏" aria-label="展开侧栏">
          <ChevronDown size={16} />
        </button>
      )}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <div className="file-title">
              <strong>{doc.fileName}</strong>
              <span>{status}</span>
            </div>
          </div>
          <div className="toolbar">
            <div className="search-box">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索正文或译文" />
              {matchCount !== null && <em>{matchCount}</em>}
            </div>
            <button className={classNames(syncMode === 'auto' && 'active')} onClick={toggleSyncMode}>
              <Link2 size={16} />
              {syncMode === 'auto' ? '自动同步' : '手动同步'}
            </button>
            <button onClick={() => runQueuedLlmRefinement({ manual: true })} title="同步已记录的修改">
              <Check size={16} />
              同步
            </button>
            <div className="language-pair">
              <select
                value={settings.sourceLang}
                onChange={(event) => updateLanguage('source', event.target.value)}
                aria-label="选择左侧语言"
              >
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>{language.short}</option>
                ))}
              </select>
              <button className="language-swap" onClick={swapLanguages} title="互换左右语言">
                <ArrowRightLeft size={16} />
              </button>
              <select
                value={settings.targetLang}
                onChange={(event) => updateLanguage('target', event.target.value)}
                aria-label="选择右侧语言"
              >
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>{language.short}</option>
                ))}
              </select>
            </div>
            <button onClick={saveSnapshot}>
              <Save size={16} />
              保存
            </button>
            <button onClick={undoLastChange} disabled={!undoSnapshot} title="撤销上一步修改">
              <RotateCcw size={16} />
              撤销
            </button>
            <button onClick={() => setCommentsOpen((value) => !value)} className={commentsOpen ? 'active' : ''}>
              <PanelRight size={16} />
              批注
            </button>
            <button onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
              设置
            </button>
          </div>
        </header>

        <section className="document-stats">
          <div><strong>{stats.sourceChars}</strong><span>{languageShort(paneLanguages.source)}字符</span></div>
          <div><strong>{stats.targetChars}</strong><span>{languageShort(paneLanguages.target)}字符</span></div>
          <div><strong>{stats.unresolved}</strong><span>未解决批注</span></div>
          <div><strong>{syncMode === 'auto' ? '开启' : '暂停'}</strong><span>联动状态</span></div>
        </section>

        <section className={classNames('editor-layout', !commentsOpen && 'comments-collapsed')}>
          <div
            ref={splitAreaRef}
            className="split-area"
            style={{ '--left-width': `${leftWidth}%` }}
          >
            <DocumentPane
              title="原文"
              side="source"
              icon={<AlignJustify size={17} />}
              text={displaySourceText}
              paneId="source"
              format={doc.format}
              active={activeSide === 'source'}
              dirty={doc.lastEdited === 'source'}
              languageLabelText={languageLabel(paneLanguages.source)}
              commentHighlights={sourceCommentHighlights}
              searchHighlights={searchState.source.terms}
              searchMatchBlockIndexes={searchState.source.matchBlockIndexes}
              searchRelatedBlockIndexes={searchState.source.relatedBlockIndexes}
              onFocus={() => setActiveSide('source')}
              onSelectionChange={(text, rect) => updateCommentSelection('source', text, rect)}
              onChange={(value, options) => updateText('source', value, options)}
              onPreviewChange={(value, options) => previewText('source', value, options)}
              onExportText={() => exportText('source')}
            />

            <button className="split-handle" onPointerDown={startResize} title="拖动调整左右宽度" aria-label="拖动调整左右宽度">
              <GripVertical size={18} />
            </button>

            <DocumentPane
              title="译文"
              side="target"
              icon={<Languages size={17} />}
              text={displayTargetText}
              paneId="target"
              format={doc.format}
              active={activeSide === 'target'}
              dirty={doc.lastEdited === 'target'}
              languageLabelText={languageLabel(paneLanguages.target)}
              commentHighlights={targetCommentHighlights}
              searchHighlights={searchState.target.terms}
              searchMatchBlockIndexes={searchState.target.matchBlockIndexes}
              searchRelatedBlockIndexes={searchState.target.relatedBlockIndexes}
              onFocus={() => setActiveSide('target')}
              onSelectionChange={(text, rect) => updateCommentSelection('target', text, rect)}
              onChange={(value, options) => updateText('target', value, options)}
              onPreviewChange={(value, options) => previewText('target', value, options)}
              onExportText={() => exportText('target')}
            />
          </div>

          {commentsOpen && (
            <CommentsPanel
              comments={visibleComments}
              activeSide={activeSide}
              draft={draftComment}
              onDraftChange={(text) => setDraftComment((current) => current ? { ...current, text } : current)}
              onDraftSave={saveCommentDraft}
              onDraftCancel={cancelCommentDraft}
              onToggle={toggleComment}
              onRemove={removeComment}
            />
          )}
        </section>
      </main>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          cloudEnabled={cloudEnabled}
          displayName={displayNameDraft}
          profileStatus={profileStatus}
          onChange={applySettings}
          onDisplayNameChange={setDisplayNameDraft}
          onDisplayNameSave={saveDisplayName}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {selectedCommentText.text && selectedCommentText.rect && (
        <button
          className="floating-comment-button"
          style={{
            left: `${selectedCommentText.rect.left}px`,
            top: `${selectedCommentText.rect.top}px`,
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => startCommentDraft(selectedCommentText.side)}
        >
          <MessageSquarePlus size={15} />
          批注
        </button>
      )}
    </div>
  );
}

function scrollToHeading(id) {
  document
    .querySelector(`[data-side="source"][data-heading-id="${id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function DocumentPane({
  title,
  side,
  paneId,
  format,
  icon,
  text,
  active,
  dirty,
  languageLabelText,
  commentHighlights,
  searchHighlights,
  searchMatchBlockIndexes,
  searchRelatedBlockIndexes,
  onFocus,
  onSelectionChange,
  onChange,
  onPreviewChange,
  onExportText,
}) {
  const [viewMode, setViewMode] = useState('rendered');
  const renderedRef = useRef(null);
  const renderedDirtyRef = useRef(false);
  const renderedTextRef = useRef(text);
  const [renderedResetKey, setRenderedResetKey] = useState(0);
  const inlineHighlights = buildInlineHighlights(commentHighlights, searchHighlights);

  useEffect(() => {
    if (renderedTextRef.current === text) return;
    renderedTextRef.current = text;
    renderedDirtyRef.current = false;
    setRenderedResetKey((current) => current + 1);
  }, [text]);

  function commitRenderedEdit(element = renderedRef.current) {
    if (!element || viewMode !== 'rendered') return;
    if (!renderedDirtyRef.current) return;
    const nextText = serializeRenderedDocument(element, format);
    renderedDirtyRef.current = false;
    if (nextText !== text.trim()) {
      onChange(nextText, { rendered: true });
    }
  }

  function previewRenderedEdit(event) {
    renderedDirtyRef.current = true;
    const nextText = serializeRenderedDocument(event.currentTarget, format);
    if (nextText !== text.trim()) {
      onPreviewChange(nextText, { rendered: true });
    }
  }

  function handleRenderedKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    document.execCommand(event.shiftKey ? 'insertLineBreak' : 'insertParagraph');
    window.requestAnimationFrame(() => {
      if (renderedRef.current) {
        previewRenderedEdit({ currentTarget: renderedRef.current });
      }
    });
  }

  function captureRenderedSelection() {
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const paneRect = document.querySelector(`[data-pane-side="${side}"]`)?.getBoundingClientRect();
      onSelectionChange(selection?.toString() ?? '', getFloatingCommentPosition(rect, paneRect));
    });
  }

  function captureTextareaSelection(event) {
    const element = event.currentTarget;
    const paneRect = element.closest('.document-pane')?.getBoundingClientRect();
    onSelectionChange(
      element.value.slice(element.selectionStart, element.selectionEnd),
      getFloatingCommentPosition(null, paneRect)
    );
  }

  function preparePaneFocus() {
    const activePane = document.activeElement?.closest?.('[data-pane-side]');
    if (activePane && activePane.getAttribute('data-pane-side') !== side) {
      document.activeElement.blur();
    }
  }

  function switchViewMode(nextMode) {
    commitRenderedEdit();
    setViewMode(nextMode);
  }

  return (
    <section className={classNames('editor-pane document-pane', active && 'active')} data-pane-side={side}>
      <div className="pane-header">
        <div className="pane-title">
          {icon}
          <strong>{title}</strong>
          <span>{dirty ? '已修改' : languageLabelText}</span>
        </div>
        <div className="pane-actions">
          <div className="view-toggle" aria-label={`${title}显示方式`}>
            <button className={viewMode === 'raw' ? 'active' : ''} onMouseDown={() => commitRenderedEdit()} onClick={() => switchViewMode('raw')}>原稿</button>
            <button className={viewMode === 'rendered' ? 'active' : ''} onMouseDown={() => commitRenderedEdit()} onClick={() => switchViewMode('rendered')}>渲染</button>
          </div>
          <button className="icon-action" title="导出文本" onClick={onExportText}><Download size={15} /></button>
        </div>
      </div>

      <div className="document-surface" onMouseDownCapture={() => { preparePaneFocus(); onFocus(); }} onClick={onFocus}>
        {viewMode === 'raw' ? (
          <div className="raw-editor-stack">
            <pre className="raw-highlight-layer" aria-hidden="true">{renderHighlightedText(text || ' ', inlineHighlights)}</pre>
            <textarea
              className="whole-textarea raw-highlight-input"
              value={text}
              onFocus={onFocus}
              onSelect={captureTextareaSelection}
              onMouseUp={captureTextareaSelection}
              onKeyUp={captureTextareaSelection}
              onChange={(event) => onChange(event.target.value)}
              spellCheck={side === 'source'}
            />
          </div>
        ) : (
          <RenderedDocument
            key={`${paneId}:${renderedResetKey}`}
            ref={renderedRef}
            text={text}
            side={paneId}
            commentHighlights={commentHighlights}
            searchHighlights={searchHighlights}
            searchMatchBlockIndexes={searchMatchBlockIndexes}
            searchRelatedBlockIndexes={searchRelatedBlockIndexes}
            editable={active}
            onFocus={onFocus}
            onInput={previewRenderedEdit}
            onKeyDown={handleRenderedKeyDown}
            onMouseUp={captureRenderedSelection}
            onKeyUp={captureRenderedSelection}
            onBlur={(event) => commitRenderedEdit(event.currentTarget)}
          />
        )}
      </div>
    </section>
  );
}

function rectFromDomRect(rect) {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function getFocusedTextareaSelection() {
  const element = document.activeElement;
  if (!(element instanceof HTMLTextAreaElement) || !element.closest('.document-pane')) return null;
  if (element.selectionStart === element.selectionEnd) return null;
  const pane = element.closest('.document-pane');
  const side = pane?.dataset.paneSide;
  const text = element.value.slice(element.selectionStart, element.selectionEnd).trim();
  if (!side || !text) return null;
  return {
    side,
    text,
    rect: getFloatingCommentPosition(null, pane.getBoundingClientRect()),
  };
}

function getFloatingCommentPosition(selectionRect, paneRect) {
  if (!paneRect) return null;
  const pane = rectFromDomRect(paneRect);
  const rect = selectionRect ? rectFromDomRect(selectionRect) : null;
  const hasUsableRect = rect
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.right)
    && (rect.top > 0 || rect.right > 0 || rect.bottom > 0 || rect.left > 0)
    && rect.top >= pane.top - 12
    && rect.top <= pane.bottom + 12;
  const idealLeft = hasUsableRect ? rect.right + 8 : pane.right - 80;
  const idealTop = hasUsableRect ? rect.top : pane.top + 48;

  return {
    left: clamp(idealLeft, pane.left + 8, pane.right - 76),
    top: clamp(idealTop, pane.top + 8, pane.bottom - 38),
  };
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function isPlainPointerClick(event, start) {
  if (!start || !event.target.closest?.('.document-pane')) return false;
  return Math.abs(event.clientX - start.x) < 4 && Math.abs(event.clientY - start.y) < 4;
}

function AuthScreen({ mode, form, error, notice, submitting, onModeChange, onFormChange, onSubmit }) {
  const isSignup = mode === 'signup';
  const submitLabel = submitting ? (isSignup ? '正在注册...' : '正在登录...') : (isSignup ? '注册' : '登录');
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark"><Languages size={22} /></div>
          <div>
            <strong>双语稿件台</strong>
            <span>登录后保存文档并邀请多人协作。</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          {isSignup && (
            <label>
              <span>显示名</span>
              <input
                value={form.displayName}
                onChange={(event) => onFormChange({ ...form, displayName: event.target.value })}
                placeholder={DEFAULT_DISPLAY_NAME}
                disabled={submitting}
              />
            </label>
          )}
          <label>
            <span>邮箱</span>
            <input
              value={form.email}
              onChange={(event) => onFormChange({ ...form, email: event.target.value })}
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              disabled={submitting}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              value={form.password}
              onChange={(event) => onFormChange({ ...form, password: event.target.value })}
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="至少 6 位"
              disabled={submitting}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}
          <button type="submit" disabled={submitting}>{submitLabel}</button>
        </form>

        <button className="auth-switch" onClick={() => onModeChange(isSignup ? 'signin' : 'signup')} disabled={submitting}>
          {isSignup ? '已有账号，去登录' : '没有账号，注册一个'}
        </button>
      </section>
    </main>
  );
}

function SettingsPanel({ settings, cloudEnabled, displayName, profileStatus, onChange, onDisplayNameChange, onDisplayNameSave, onClose }) {
  function update(patch) {
    onChange({ ...settings, ...patch });
  }

  function updateProvider(providerId) {
    const preset = TRANSLATION_PROVIDERS.find((item) => item.id === providerId) ?? TRANSLATION_PROVIDERS[0];
    update({
      translationProvider: providerId,
      translationBaseUrl: preset.baseUrl,
      translationModel: preset.model,
    });
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <strong>设置</strong>
            <span>账号、主题与翻译方向</span>
          </div>
          <button onClick={onClose} title="关闭"><X size={16} /></button>
        </div>

        {cloudEnabled && (
          <div className="settings-section">
            <label className="settings-label">用户信息</label>
            <div className="profile-form">
              <input
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                placeholder="显示名"
                aria-label="显示名"
              />
              <button type="button" onClick={onDisplayNameSave}>保存</button>
            </div>
            {profileStatus && <p className="settings-note">{profileStatus}</p>}
          </div>
        )}

        <div className="settings-section">
          <label className="settings-label">主题色</label>
          <div className="accent-picker">
            <input
              type="range"
              min="0"
              max="359"
              value={settings.accentHue}
              onChange={(event) => update({ accentHue: Number(event.target.value) })}
              aria-label="主题色"
            />
            <span style={{ background: `hsl(${settings.accentHue} 78% 45%)` }} />
          </div>
        </div>

        <div className="settings-section">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.sourceLang === 'auto' && settings.targetLang === 'auto'}
              onChange={(event) => update(event.target.checked
                ? { sourceLang: 'auto', targetLang: 'auto' }
                : { sourceLang: inferSourceLanguage(SAMPLE_SOURCE), targetLang: inferTargetLanguage(SAMPLE_SOURCE) }
              )}
            />
            <span>
              <strong>智能识别语言方向</strong>
              <em>非中文输入 → 中文；中文输入 → 英文</em>
            </span>
          </label>
        </div>

        <div className="settings-grid">
          <label>
            <span>左侧默认语言</span>
            <select
              value={settings.sourceLang}
              onChange={(event) => update({ sourceLang: event.target.value })}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>{language.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>右侧默认语言</span>
            <select
              value={settings.targetLang}
              onChange={(event) => update({ targetLang: event.target.value })}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>{language.label}</option>
              ))}
            </select>
          </label>
        </div>

        <p className="settings-note">
          翻译、同步、润色和批注处理只调用你配置的大模型接口；未配置 Key 时不会自动生成译文。
        </p>

        <div className="settings-section">
          <label className="settings-label">翻译服务</label>
          <div className="settings-grid">
            <label>
              <span>服务商</span>
              <select
                value={settings.translationProvider}
                onChange={(event) => updateProvider(event.target.value)}
              >
                {TRANSLATION_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>模型</span>
              <input
                value={settings.translationModel}
                onChange={(event) => update({ translationModel: event.target.value })}
                placeholder={settings.translationProvider === 'deepseek' ? 'deepseek-chat' : 'moonshotai/kimi-k2.6'}
              />
            </label>
          </div>

          <label className="settings-field">
            <span>API Key</span>
            <input
              type="password"
                value={settings.translationApiKey}
                onChange={(event) => update({ translationApiKey: event.target.value })}
                placeholder="请输入你自己的 API Key"
                autoComplete="off"
              />
          </label>

          <label className="settings-field">
            <span>接口地址</span>
            <input
              value={settings.translationBaseUrl}
              onChange={(event) => update({ translationBaseUrl: event.target.value })}
              placeholder="https://api.deepseek.com/v1/chat/completions"
            />
          </label>

          <p className="settings-note">
            必须输入你自己的 API Key 才会调用翻译服务。Key 只保存在当前浏览器本地，用于通过本站后端代理请求兼容 OpenAI Chat Completions 的翻译接口。
          </p>
        </div>

      </section>
    </div>
  );
}

const RenderedDocument = React.memo(React.forwardRef(function RenderedDocument({
  text,
  side,
  commentHighlights = [],
  searchHighlights = [],
  searchMatchBlockIndexes = new Set(),
  searchRelatedBlockIndexes = new Set(),
  editable = false,
  onFocus,
  onInput,
  onKeyDown,
  onBlur,
}, ref) {
  const blocks = renderBlocks(text);
  let headingIndex = 0;
  const inlineHighlights = buildInlineHighlights(commentHighlights, searchHighlights);

  function blockClassName(index, baseClassName) {
    return classNames(
      baseClassName,
      searchMatchBlockIndexes.has(index) && 'search-match-block',
      searchRelatedBlockIndexes.has(index) && 'search-related-block'
    );
  }

  return (
    <div
      className="rendered-body document-rendered"
      ref={ref}
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck
      onFocus={onFocus}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      role={editable ? 'textbox' : undefined}
      aria-multiline={editable ? 'true' : undefined}
    >
      {blocks.map((block, index) => {
        if (block.type === 'h1') {
          headingIndex += 1;
          return (
            <h2 key={index} className={blockClassName(index)} data-side={side} data-heading-id={`heading-${headingIndex}`}>
              {renderInline(block.text, inlineHighlights)}
            </h2>
          );
        }
        if (block.type === 'h2') {
          headingIndex += 1;
          return (
            <h3 key={index} className={blockClassName(index)} data-side={side} data-heading-id={`heading-${headingIndex}`}>
              {renderInline(block.text, inlineHighlights)}
            </h3>
          );
        }
        if (block.type === 'equation') return <pre key={index} className={blockClassName(index, 'rendered-equation')}>{block.text}</pre>;
        if (block.type === 'list') return <p key={index} className={blockClassName(index, 'rendered-list')}>{renderInline(block.text, inlineHighlights)}</p>;
        return <p key={index} className={blockClassName(index)}>{renderInline(block.text, inlineHighlights)}</p>;
      })}
    </div>
  );
}), (previous, next) => {
  if (!previous.editable && !next.editable) return false;
  return previous.editable === next.editable
    && previous.text === next.text
    && previous.side === next.side;
});

function serializeRenderedDocument(root, format) {
  const blocks = Array.from(root.children)
    .flatMap((element) => serializeRenderedElement(element, format))
    .filter(Boolean);

  return blocks.length ? blocks.join('\n\n') : renderedNodeText(root).trim();
}

function serializeRenderedElement(element, format) {
  const text = renderedNodeText(element).trim();
  if (!text) return [];

  if (element.matches('h2')) {
    return [serializeRenderedBlock('h1', text, format)];
  }

  if (element.matches('h3')) {
    return [serializeRenderedBlock('h2', text, format)];
  }

  if (element.matches('pre')) {
    return [serializeRenderedBlock('equation', text, format)];
  }

  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function renderedNodeText(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00a0/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.tagName === 'BR') return '\n';

  const childText = Array.from(node.childNodes).map(renderedNodeText).join('');
  if (/^(DIV|P|H1|H2|H3|H4|H5|H6|PRE|LI)$/i.test(node.tagName)) {
    return `${childText}\n`;
  }
  return childText;
}

function serializeTextForRenderedEditing(text, format) {
  return renderBlocks(text)
    .map((block) => serializeRenderedBlock(block.type, block.text, format))
    .filter(Boolean)
    .join('\n\n');
}

function serializeRenderedBlock(type, text, format) {
  if (type === 'h1') {
    if (format === 'tex') return `\\section{${text}}`;
    if (format === 'md') return `# ${text}`;
    return text;
  }

  if (type === 'h2') {
    if (format === 'tex') return `\\subsection{${text}}`;
    if (format === 'md') return `## ${text}`;
    return text;
  }

  if (type === 'equation') {
    if (format === 'tex') return `\\begin{equation}\n  ${text}\n\\end{equation}`;
    if (format === 'md') return `$$\n${text}\n$$`;
    return text;
  }

  return text;
}

function renderBlocks(text) {
  const cleaned = text.trim();
  const blocks = [];
  let equationBuffer = null;

  cleaned.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (/^\\begin\{equation\}/.test(trimmed)) {
      equationBuffer = [trimmed.replace(/^\\begin\{equation\}/, '').trim()];
      return;
    }

    if (equationBuffer) {
      if (/\\end\{equation\}$/.test(trimmed)) {
        equationBuffer.push(trimmed.replace(/\\end\{equation\}$/, '').trim());
        blocks.push({ type: 'equation', text: normalizeFormula(equationBuffer.join(' ')) });
        equationBuffer = null;
      } else {
        equationBuffer.push(trimmed);
      }
      return;
    }

    const sectionMatch = trimmed.match(/^\\section\{([^}]*)\}$/);
    if (sectionMatch) {
      blocks.push({ type: 'h1', text: sectionMatch[1] });
      return;
    }

    const subsectionMatch = trimmed.match(/^\\subsection\{([^}]*)\}$/);
    if (subsectionMatch) {
      blocks.push({ type: 'h2', text: subsectionMatch[1] });
      return;
    }

    const mdHeading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (mdHeading) {
      blocks.push({ type: mdHeading[1].length === 1 ? 'h1' : 'h2', text: mdHeading[2] });
      return;
    }

    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      blocks.push({ type: 'list', text: listMatch[1] });
      return;
    }

    blocks.push({ type: 'p', text: trimmed });
  });

  if (equationBuffer) {
    blocks.push({ type: 'equation', text: normalizeFormula(equationBuffer.join(' ')) });
  }

  return blocks.length ? blocks : [{ type: 'p', text: cleaned }];
}

function getSearchState(sourceText, targetText, rawQuery) {
  const query = rawQuery.trim();
  if (!query) {
    return {
      query: '',
      totalMatches: 0,
      source: emptySearchSide(),
      target: emptySearchSide(),
    };
  }

  const sourceTerms = buildSearchTerms(query, 'source');
  const targetTerms = buildSearchTerms(query, 'target');
  const sourceBlocks = renderBlocks(sourceText);
  const targetBlocks = renderBlocks(targetText);
  const sourceMatchBlockIndexes = blockIndexesMatchingTerms(sourceBlocks, sourceTerms);
  const targetMatchBlockIndexes = blockIndexesMatchingTerms(targetBlocks, targetTerms);
  const sourceRelatedBlockIndexes = matchingIndexSet(targetMatchBlockIndexes, sourceBlocks.length);
  const targetRelatedBlockIndexes = matchingIndexSet(sourceMatchBlockIndexes, targetBlocks.length);

  sourceMatchBlockIndexes.forEach((index) => sourceRelatedBlockIndexes.delete(index));
  targetMatchBlockIndexes.forEach((index) => targetRelatedBlockIndexes.delete(index));

  return {
    query,
    totalMatches: countSearchMatches(sourceText, sourceTerms) + countSearchMatches(targetText, targetTerms),
    source: {
      terms: sourceTerms,
      matchBlockIndexes: sourceMatchBlockIndexes,
      relatedBlockIndexes: sourceRelatedBlockIndexes,
    },
    target: {
      terms: targetTerms,
      matchBlockIndexes: targetMatchBlockIndexes,
      relatedBlockIndexes: targetRelatedBlockIndexes,
    },
  };
}

function emptySearchSide() {
  return {
    terms: [],
    matchBlockIndexes: new Set(),
    relatedBlockIndexes: new Set(),
  };
}

function buildSearchTerms(query) {
  return uniqueSearchTerms([query]).sort((a, b) => b.length - a.length);
}

function uniqueSearchTerms(terms) {
  const seen = new Set();
  return terms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .filter((term) => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function blockIndexesMatchingTerms(blocks, terms) {
  const indexes = new Set();
  if (!terms.length) return indexes;
  blocks.forEach((block, index) => {
    if (terms.some((term) => includesIgnoreCase(block.text, term))) {
      indexes.add(index);
    }
  });
  return indexes;
}

function matchingIndexSet(sourceIndexes, maxSize) {
  const related = new Set();
  sourceIndexes.forEach((index) => {
    if (index < maxSize) related.add(index);
  });
  return related;
}

function countSearchMatches(text, terms) {
  let total = 0;
  const lowerText = text.toLowerCase();
  terms.forEach((term) => {
    const lowerTerm = term.toLowerCase();
    let cursor = 0;
    while (lowerTerm && cursor < lowerText.length) {
      const index = lowerText.indexOf(lowerTerm, cursor);
      if (index === -1) break;
      total += 1;
      cursor = index + lowerTerm.length;
    }
  });
  return total;
}

function includesIgnoreCase(text, term) {
  return text.toLowerCase().includes(term.toLowerCase());
}

function extractOutline(text) {
  let headingIndex = 0;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      const section = trimmed.match(/^\\section\{([^}]*)\}$/);
      if (section) {
        headingIndex += 1;
        return { id: `heading-${headingIndex}`, level: 1, text: section[1] };
      }
      const subsection = trimmed.match(/^\\subsection\{([^}]*)\}$/);
      if (subsection) {
        headingIndex += 1;
        return { id: `heading-${headingIndex}`, level: 2, text: subsection[1] };
      }
      const mdHeading = trimmed.match(/^(#{1,2})\s+(.+)$/);
      if (mdHeading) {
        headingIndex += 1;
        return { id: `heading-${headingIndex}`, level: mdHeading[1].length, text: mdHeading[2] };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeFormula(text) {
  return text
    .replaceAll('\\mid', '|')
    .replaceAll('\\prod', '∏')
    .replaceAll('\\sum', '∑')
    .replaceAll('\\theta', 'θ')
    .replaceAll('\\nabla', '∇')
    .replaceAll('\\leq', '≤')
    .replaceAll('\\geq', '≥')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCommentHighlights(comments, side, draft) {
  const candidates = [];

  comments
    .filter((comment) => !comment.resolved)
    .forEach((comment) => {
      candidates.push(...commentHighlightCandidates(comment, side));
    });

  if (draft?.quote && draft.side === side) {
    candidates.push({ text: draft.quote, priority: 30 });
  }

  const unique = new Map();
  candidates.forEach((candidate) => {
    const text = normalizeHighlightQuote(candidate.text);
    if (text.length < 2) return;
    const key = text.toLowerCase();
    const current = unique.get(key);
    if (!current || candidate.priority > current.priority) unique.set(key, { ...candidate, text });
  });

  return [...unique.values()]
    .sort((a, b) => b.priority - a.priority || b.text.length - a.text.length)
    .map((candidate) => candidate.text);
}

function commentHighlightCandidates(comment, side) {
  const active = comment[side];
  return active?.quote ? [{ text: active.quote, priority: 30 }] : [];
}

function pairedQuoteCandidates(quote, side) {
  const converted = makePairedCommentText(quote, side, 'quote');
  return [{ text: converted, priority: 25 }];
}

function alignedCommentSpanCandidates(otherQuote, side, sourceText, targetText) {
  const otherText = side === 'source' ? targetText : sourceText;
  const activeBlocks = renderBlocks(side === 'source' ? sourceText : targetText);
  const otherBlocks = renderBlocks(otherText);
  const candidates = [];

  const match = blockMatchContainingQuote(otherBlocks, otherQuote);
  if (match && activeBlocks[match.index]?.text) {
    const span = proportionalTextSpan(
      activeBlocks[match.index].text,
      match.start / Math.max(1, match.blockText.length),
      match.end / Math.max(1, match.blockText.length)
    );
    if (span) candidates.push({ text: span, priority: 15 });
  }

  return candidates;
}

function blockMatchContainingQuote(blocks, quote) {
  const normalizedQuote = normalizeHighlightQuote(quote).toLowerCase();
  if (normalizedQuote.length < 2) return null;
  for (let index = 0; index < blocks.length; index += 1) {
    const blockText = normalizeHighlightQuote(blocks[index].text);
    const lowerBlock = blockText.toLowerCase();
    const start = lowerBlock.indexOf(normalizedQuote);
    if (start !== -1) {
      return { index, start, end: start + normalizedQuote.length, blockText };
    }
  }
  return null;
}

function proportionalTextSpan(text, startRatio, endRatio) {
  const value = normalizeHighlightQuote(text);
  if (value.length < 2) return '';
  let start = Math.max(0, Math.floor(value.length * startRatio));
  let end = Math.min(value.length, Math.ceil(value.length * endRatio));
  if (end <= start) end = Math.min(value.length, start + 1);

  while (start > 0 && isWordChar(value[start - 1]) && isWordChar(value[start])) start -= 1;
  while (end < value.length && isWordChar(value[end - 1]) && isWordChar(value[end])) end += 1;

  const span = value.slice(start, end).replace(/^[\s,.;:!?，。；：！？、]+|[\s,.;:!?，。；：！？、]+$/g, '');
  if (span.length < 2) return '';
  if (span.length > value.length * 0.65) return '';
  return span;
}

function isWordChar(char) {
  return /[A-Za-z0-9_\-]/.test(char ?? '');
}

function normalizeHighlightQuote(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildInlineHighlights(commentHighlights, searchHighlights) {
  return [
    ...commentHighlights.map((text) => ({ text, className: 'comment-highlight' })),
    ...searchHighlights.map((text) => ({ text, className: 'search-highlight' })),
  ].sort((a, b) => b.text.length - a.text.length);
}

function renderInline(text, highlights = []) {
  const pieces = text.split(/(\$[^$]+\$|\\\([^)]+\\\)|\\[a-zA-Z]+\{[^}]*\})/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (piece.startsWith('$') && piece.endsWith('$')) {
      return <code key={index}>{normalizeFormula(piece.slice(1, -1))}</code>;
    }
    if (piece.startsWith('\\(') && piece.endsWith('\\)')) {
      return <code key={index}>{normalizeFormula(piece.slice(2, -2))}</code>;
    }
    const command = piece.match(/^\\[a-zA-Z]+\{([^}]*)\}$/);
    if (command) {
      return <span key={index}>{renderHighlightedText(command[1], highlights)}</span>;
    }
    return <React.Fragment key={index}>{renderHighlightedText(piece, highlights)}</React.Fragment>;
  });
}

function renderHighlightedText(text, highlights) {
  if (!highlights.length || !text) return text;

  const parts = [];
  const lowerText = text.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    let nextMatch = null;
    highlights.forEach((highlight) => {
      const index = lowerText.indexOf(highlight.text.toLowerCase(), cursor);
      if (index === -1) return;
      if (!nextMatch || index < nextMatch.index || (index === nextMatch.index && highlight.text.length > nextMatch.text.length)) {
        nextMatch = { index, text: highlight.text, className: highlight.className };
      }
    });

    if (!nextMatch) {
      parts.push(text.slice(cursor));
      break;
    }

    if (nextMatch.index > cursor) {
      parts.push(text.slice(cursor, nextMatch.index));
    }

    const end = nextMatch.index + nextMatch.text.length;
    parts.push(
      <mark key={`${nextMatch.index}-${end}-${parts.length}`} className={nextMatch.className}>
        {text.slice(nextMatch.index, end)}
      </mark>
    );
    cursor = end;
  }

  return parts;
}

function CommentsPanel({ comments, activeSide, draft, onDraftChange, onDraftSave, onDraftCancel, onToggle, onRemove }) {
  const sideComments = comments.filter((comment) => comment[activeSide]?.quote || comment[activeSide]?.text);
  return (
    <aside className="comments-panel">
      <div className="comments-header">
        <div>
          <strong>批注</strong>
          <span>{activeSide === 'source' ? '原文侧' : '译文侧'}</span>
        </div>
      </div>
      <div className="comment-list">
        {draft && (
          <CommentDraft
            draft={draft}
            activeSide={activeSide}
            onChange={onDraftChange}
            onSave={onDraftSave}
            onCancel={onDraftCancel}
          />
        )}
        {sideComments.length === 0 && !draft && (
          <div className="empty-comments">
            <Highlighter size={22} />
            <strong>暂无批注</strong>
            <span>选中文本后添加修改建议，DeepSeek 同步时会参考。</span>
          </div>
        )}
        {sideComments.map((comment) => {
          const display = comment[activeSide];
          return (
          <article key={comment.id} className={classNames('comment-item', comment.resolved && 'resolved')}>
            <div className="comment-top">
              <span>{activeSide === 'source' ? '原文侧' : '译文侧'}</span>
              <button onClick={() => onRemove(comment.id)} title="删除"><X size={14} /></button>
            </div>
            <blockquote>{display.quote}</blockquote>
            <p>{display.text}</p>
            <div className="comment-footer">
              <span>{comment.createdAt}</span>
              <button onClick={() => onToggle(comment.id)}>
                {comment.resolved ? <ChevronDown size={14} /> : <Check size={14} />}
                {comment.resolved ? '重新打开' : '解决'}
              </button>
            </div>
          </article>
          );
        })}
      </div>
    </aside>
  );
}

function CommentDraft({ draft, activeSide, onChange, onSave, onCancel }) {
  const inputRef = useRef(null);
  const quote = draft.quote;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <article className="comment-draft">
      <div className="comment-top">
        <span>{activeSide === 'source' ? '原文侧新批注' : '译文侧新批注'}</span>
        <button onClick={onCancel} title="取消"><X size={14} /></button>
      </div>
      <blockquote>{quote}</blockquote>
      <textarea
        ref={inputRef}
        value={draft.text}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入批注..."
        rows={4}
      />
      <div className="draft-actions">
        <button onClick={onCancel}>取消</button>
        <button className="primary" onClick={onSave} disabled={!draft.text.trim()}>
          保存
        </button>
      </div>
    </article>
  );
}

function legacyCommentSide(comment, activeSide) {
  const text = comment.text ?? '';
  const quote = comment.quote ?? '';
  return {
    text,
    quote,
  };
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Bilingual editor render failed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error">
        <section>
          <strong>页面加载失败</strong>
          <p>当前编辑状态出现异常。可以刷新页面；如果仍然失败，重置文档不会清除你的翻译 API Key。</p>
          <div className="app-error-actions">
            <button onClick={() => window.location.reload()}>刷新</button>
            <button onClick={() => { window.location.href = `${window.location.pathname}?reset=1`; }}>重置文档</button>
          </div>
          <code>{String(this.state.error?.message ?? this.state.error)}</code>
        </section>
      </main>
    );
  }
}

const rootElement = document.getElementById('root');
const appRoot = rootElement.__bilingualEditorRoot ?? createRoot(rootElement);
rootElement.__bilingualEditorRoot = appRoot;
appRoot.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
