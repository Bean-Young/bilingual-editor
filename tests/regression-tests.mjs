import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractJson, normalizeModelTranslations } from '../api/translate.js';

const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const translateApiSource = readFileSync(new URL('../api/translate.js', import.meta.url), 'utf8');

function proportionalTextSpan(text, startRatio, endRatio) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length < 2) return '';
  let start = Math.max(0, Math.floor(value.length * startRatio));
  let end = Math.min(value.length, Math.ceil(value.length * endRatio));
  if (end <= start) end = Math.min(value.length, start + 1);
  while (start > 0 && /[A-Za-z0-9_\-]/.test(value[start - 1]) && /[A-Za-z0-9_\-]/.test(value[start])) start -= 1;
  while (end < value.length && /[A-Za-z0-9_\-]/.test(value[end - 1]) && /[A-Za-z0-9_\-]/.test(value[end])) end += 1;
  const span = value.slice(start, end).replace(/^[\s,.;:!?，。；：！？、]+|[\s,.;:!?，。；：！？、]+$/g, '');
  if (span.length < 2) return '';
  if (span.length > value.length * 0.65) return '';
  return span;
}

function renderBlocks(text) {
  const cleaned = String(text ?? '').trim();
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
        blocks.push({ type: 'equation', text: equationBuffer.join(' ').replace(/\s+/g, ' ').trim() });
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

    blocks.push({ type: 'p', text: trimmed });
  });

  if (equationBuffer) {
    blocks.push({ type: 'equation', text: equationBuffer.join(' ').replace(/\s+/g, ' ').trim() });
  }

  return blocks.length ? blocks : [{ type: 'p', text: cleaned }];
}

function serializeRenderedBlock(type, text, format) {
  if (type === 'h1') return format === 'tex' ? `\\section{${text}}` : text;
  if (type === 'h2') return format === 'tex' ? `\\subsection{${text}}` : text;
  if (type === 'equation') return format === 'tex' ? `\\begin{equation}\n  ${text}\n\\end{equation}` : text;
  return text;
}

function appendLocalPatch(text, patch) {
  if (!text.trim()) return patch;
  const left = text.trim();
  const right = patch.trim();
  const noSpace = /\s$/.test(text)
    || /^[,.;:!?，。；：！？、]/.test(right)
    || (/[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff]/.test(right));
  return `${text}${noSpace ? '' : ' '}${patch}`;
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
      key: `insert:${passiveBlock.index}`,
      index: passiveBlock.index,
      previousText: '',
      text: insertedText,
      reference: passiveBlock.text,
      paragraphInsertion: true,
      change: {
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
      key: block.key,
      index: passiveBlock.index,
      previousText: previousBlock.text,
      text: block.text,
      reference: passiveBlock.text,
      paragraphInsertion: false,
    });
  });

  flushInsertedRun(lastMatchedBlock);
  return jobs;
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

function segmentSyncBlocks(text) {
  const value = String(text ?? '');
  if (!value) return [];
  const blocks = [];
  const separatorPattern = /\n\s*\n+/g;
  let lastIndex = 0;
  let match;
  while ((match = separatorPattern.exec(value)) !== null) {
    blocks.push({ text: value.slice(lastIndex, match.index), separator: match[0] });
    lastIndex = match.index + match[0].length;
  }
  blocks.push({ text: value.slice(lastIndex), separator: '' });
  return blocks.filter((block, index) => block.text || index === blocks.length - 1);
}

function normalizeHighlightQuote(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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
  return spans.filter((span) => span.text && span.end > start && span.start < end).map((span) => span.index);
}

function commentGuidanceJobs(activeText, passiveText, quote, suggestion) {
  const activeBlocks = segmentSyncBlocks(activeText);
  const passiveBlocks = segmentSyncBlocks(passiveText);
  const range = commentBlockRangeForQuote(activeBlocks, normalizeHighlightQuote(quote).toLowerCase());
  return range.map((index) => ({
    index,
    previousText: activeBlocks[index].text,
    text: activeBlocks[index].text,
    reference: passiveBlocks[index]?.text ?? '',
    change: { summary: `review suggestion for selected quote ${JSON.stringify(quote)}: ${JSON.stringify(suggestion)}` },
  }));
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

function replaceRenderedBlocks(text, replacements, format) {
  return renderBlocks(text)
    .map((block, index) => serializeRenderedBlock(block.type, replacements.has(index) ? replacements.get(index) : block.text, format))
    .filter(Boolean)
    .join('\n\n');
}

function insertParagraphPatch(text, separator, patch) {
  const cleanPatch = patch.trim();
  if (!text.trim()) return cleanPatch;
  const blockSeparator = separator && separator.trim() === '' ? separator : '\n\n';
  return `${text}${blockSeparator}${cleanPatch}`;
}

const removedLocalTranslationNames = [
  ['local', 'En', 'To', 'Zh'].join(''),
  ['local', 'Zh', 'To', 'En'].join(''),
  ['apply', 'English', 'Terms'].join(''),
  ['apply', 'Chinese', 'Terms'].join(''),
  ['CC', '-CEDICT'].join(''),
  ['PUBLIC', '_EN', '_TO', '_ZH', '_TERMS'].join(''),
  ['EC', 'DICT', '_EN', '_TO', '_ZH', '_TERMS'].join(''),
];
assert.ok(
  removedLocalTranslationNames.every((name) => !mainSource.includes(name)),
  'frontend should not use local translation substitutes'
);
assert.ok(
  [
    ['local', 'Translate', 'Inserted', 'Text'].join(''),
    ...removedLocalTranslationNames.slice(2),
  ].every((name) => !translateApiSource.includes(name)),
  'translate API should rely on model output instead of local substitutes'
);

const sourceBlock = 'Alpha beta gamma delta epsilon zeta.';
const targetBlock = '甲乙丙丁戊己庚辛壬癸。';
const quoteStart = sourceBlock.indexOf('Alpha beta');
const quoteEnd = quoteStart + 'Alpha beta'.length;
const span = proportionalTextSpan(targetBlock, quoteStart / sourceBlock.length, quoteEnd / sourceBlock.length);
assert.ok(span.length >= 2, `aligned highlight should create a useful short span, got ${JSON.stringify(span)}`);
assert.ok(span.length < targetBlock.length * 0.65, 'aligned highlight must not fall back to the whole translated block');

const renderedSourceBefore = String.raw`\section{Alpha}

First paragraph.

\subsection{Beta}

Second paragraph.

\begin{equation}
  x = y
\end{equation}`;
const renderedSourceAfter = renderedSourceBefore.replace('First paragraph.', 'First paragraph. hhh');
const renderedTargetBefore = String.raw`\section{甲}

第一段。

\subsection{乙}

第二段。

\begin{equation}
  x = y
\end{equation}`;
const renderedJobs = changedRenderedBlockJobs(renderedSourceBefore, renderedSourceAfter, renderedTargetBefore);
assert.equal(renderedJobs.length, 1, 'rendered realtime sync should only create a job for the edited structural block');
assert.equal(renderedJobs[0].reference, '第一段。', 'rendered realtime sync should target the paragraph in the same section scope');
assert.equal(renderedJobs[0].index, 1, 'rendered realtime sync should not drift to later sections when equations are present');
const renderedReplacement = replaceRenderedBlocks(
  renderedTargetBefore,
  new Map([[renderedJobs[0].index, appendLocalPatch(renderedJobs[0].reference, 'hhh')]]),
  'tex'
);
assert.match(renderedReplacement, /第一段。 hhh\s+\\subsection\{乙\}\s+第二段。/s, 'rendered replacement should keep the edit in the matched paragraph');
assert.doesNotMatch(renderedReplacement, /第二段。 hhh/, 'rendered replacement must not write the edit into the following section');

const renderedSourceInserted = renderedSourceBefore.replace(
  'First paragraph.',
  "First paragraph.\n\nThat's good.\n\nGreat."
);
const renderedInsertionJobs = changedRenderedBlockJobs(renderedSourceBefore, renderedSourceInserted, renderedTargetBefore);
const renderedInsertionJob = renderedInsertionJobs.find((job) => job.paragraphInsertion);
assert.ok(renderedInsertionJob, 'rendered source insertions should create a translation job instead of being skipped');
assert.equal(renderedInsertionJob.index, 1, 'rendered inserted paragraphs should anchor after the matching translated paragraph');
assert.equal(renderedInsertionJob.reference, '第一段。', 'rendered inserted paragraphs should use the matching target paragraph as insertion anchor');
assert.match(renderedInsertionJob.text, /That's good\.[\s\S]*Great\./, 'rendered inserted paragraphs should be sent to the model as the changed source text');
const renderedInsertedReplacement = replaceRenderedBlocks(
  renderedTargetBefore,
  new Map([[renderedInsertionJob.index, insertParagraphPatch(renderedInsertionJob.reference, '\n\n', '很好。\n\n很棒。')]]),
  'tex'
);
assert.match(renderedInsertedReplacement, /第一段。\s+很好。\s+很棒。\s+\\subsection\{乙\}/s, 'rendered inserted translations should be inserted after the anchored target paragraph');
assert.doesNotMatch(renderedInsertedReplacement, /\\subsection\{乙\}\s+很好。/s, 'rendered inserted translations must not drift into the next section');

assert.equal(
  mainSource.includes('key={`${paneId}:${text}`}'),
  false,
  'rendered editor must not key the contenteditable subtree by full text because each keystroke would remount it'
);
assert.equal(
  mainSource.includes('key={`${paneId}:${renderedResetKey}`}'),
  true,
  'rendered editor should reset by an external document version key so synced text does not merge with browser-mutated DOM'
);
const previewTextFunction = mainSource.match(/function previewText\(side, value, options = \{\}\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
const renderedPreviewBranch = previewTextFunction.match(/if \(options\.rendered\) \{[\s\S]*?return;\n    \}/)?.[0] ?? '';
assert.match(
  renderedPreviewBranch,
  /recordPendingSync\(side, value,/,
  'rendered preview should still record pending sync jobs'
);
assert.doesNotMatch(
  renderedPreviewBranch,
  /setRealtimePreview|\[side\]:\s*value/,
  'rendered preview must not write each keystroke into realtimePreview because that forces React to reconcile the contenteditable DOM'
);
const resetFunctionSource = mainSource.match(/function consumeLocalResetRequest\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.doesNotMatch(
  resetFunctionSource,
  /bilingual-editor:settings/,
  'resetting sample documents should not clear translation API key settings'
);
assert.match(
  mainSource,
  /class AppErrorBoundary extends React\.Component/,
  'the app should render through an error boundary instead of leaving a blank page on runtime errors'
);
assert.match(
  mainSource,
  /<AppErrorBoundary>\s*<App \/>/s,
  'the root render should wrap App in AppErrorBoundary'
);
assert.match(
  translateApiSource,
  /automatic grammar repair/,
  'translation prompt should include automatic grammar repair instructions'
);
assert.doesNotMatch(
  mainSource,
  /const activeReplacements = processedCommentIds\.size[\s\S]*?reviseActiveBlocksWithLlm/,
  'active-side grammar repair should run for ordinary edits, not only when comments exist'
);
assert.match(
  mainSource,
  /syncChangedBlocksWithLlm/,
  'ordinary edit sync should request active-side grammar repair and passive-side translation in the same synchronization step'
);
assert.match(
  mainSource,
  /upsertPendingSide\(\s*pendingLlmRefinementRef\.current,/,
  'pending sync should preserve both source-side and target-side edits instead of overwriting the previous side'
);
assert.match(
  translateApiSource,
  /For bilingual-sync use exactly this shape: \{"sources":\["\.\.\."\],"translations":\["\.\.\."\]\}/,
  'bilingual sync prompt should require both repaired source text and updated target translation'
);
assert.match(
  translateApiSource,
  /result\.sources = normalizedSources/,
  'bilingual sync API should return sources as well as translations'
);

const mergedSyncJobs = mergeSyncJobs(
  [{
    index: 0,
    previousText: 'Large language models are useful.',
    text: 'Large language models are useful for writing.',
    reference: '大型语言模型很有用。',
    change: { summary: 'inserted "for writing"' },
  }],
  [{
    index: 0,
    previousText: 'Large language models are useful for writing.',
    text: 'Large language models are useful for writing.',
    reference: '大型语言模型很有用。',
    change: { summary: 'review suggestion for selected quote "Large language models": "Use a shorter term."' },
  }]
);
assert.equal(mergedSyncJobs.length, 1, 'comment guidance should merge with an existing edited paragraph job instead of replacing it');
assert.equal(mergedSyncJobs[0].text, 'Large language models are useful for writing.', 'merged job should keep the latest edited source text');
assert.match(mergedSyncJobs[0].change.summary, /for writing/, 'merged job should preserve the user text edit summary');
assert.match(mergedSyncJobs[0].change.summary, /Use a shorter term/, 'merged job should include the review suggestion summary');

const crossBlockCommentJobs = commentGuidanceJobs(
  'First paragraph ends here.\n\nSecond paragraph starts here.',
  '第一段在这里结束。\n\n第二段从这里开始。',
  'paragraph ends here.\n\nSecond paragraph starts',
  'split and simplify'
);
assert.deepEqual(
  crossBlockCommentJobs.map((job) => job.index),
  [0, 1],
  'cross-line or cross-paragraph comment selections should create guidance jobs for every covered paragraph'
);

assert.deepEqual(
  normalizeModelTranslations(extractJson('```json\n{"translations":["甲","乙"]}\n```'), 2),
  ['甲', '乙'],
  'translation parser should accept fenced JSON without failing import'
);
assert.deepEqual(
  normalizeModelTranslations(extractJson('[{"translation":"甲"},{"text":"乙"}]'), 2),
  ['甲', '乙'],
  'translation parser should accept direct object arrays from the model'
);
assert.deepEqual(
  normalizeModelTranslations(extractJson('{"0":"甲","1":"乙"}'), 2),
  ['甲', '乙'],
  'translation parser should accept numeric-key translation objects'
);
assert.deepEqual(
  normalizeModelTranslations(extractJson('{"translations":"甲"}'), 1),
  ['甲'],
  'translation parser should accept single-string translation responses for single-chunk retries'
);
assert.equal(
  shouldRetryLlmRateLimit(Object.assign(new Error('NVIDIA 429 Too Many Requests'), { status: 429 }), { mode: 'import' }),
  true,
  'initial import should wait and retry current chunk on NVIDIA rate limits'
);
assert.equal(
  shouldRetryLlmRateLimit(Object.assign(new Error('NVIDIA 429 Too Many Requests'), { status: 429 }), { mode: 'refine' }),
  false,
  'idle refinement should not keep retrying through rate limits'
);
assert.equal(llmRateLimitDelayMs(0), 15_000, 'first rate-limit retry should back off instead of immediately hammering the API');

console.log('regression tests passed');
