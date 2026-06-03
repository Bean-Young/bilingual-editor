import fs from 'node:fs';
import zlib from 'node:zlib';

const sourcePath = new URL('../data/dictionaries/cedict_1_0_ts_utf-8_mdbg.txt.gz', import.meta.url);
const outputPath = new URL('../src/translation/publicZhEnTerms.js', import.meta.url);

const stopDefinitions = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const noisyPatterns = [
  /^surname\b/i,
  /^variant of\b/i,
  /^old variant of\b/i,
  /^also written\b/i,
  /^see\b/i,
  /^abbr\.? for\b/i,
  /^classifier\b/i,
  /^measure word\b/i,
  /^used in\b/i,
  /\bCL:/,
  /\berhua variant\b/i,
  /\bcalled\b/i,
  /\bwhich\b/i,
  /\bwhere\b/i,
  /\bwhen\b/i,
  /\bwhose\b/i,
  /\bused to\b/i,
  /\bused for\b/i,
  /\bInternet slang\b/i,
];

function isUsefulChineseTerm(term) {
  return /^[\u3400-\u9fff]{2,8}$/.test(term);
}

function normalizeDefinition(definition) {
  return definition
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\bTaiwan pr\.?\b/gi, ' ')
    .replace(/\bPRC pr\.?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^to\s+/i, '');
}

function isUsefulEnglishTerm(term) {
  const lower = term.toLowerCase();
  if (!term || stopDefinitions.has(lower)) return false;
  if (term.length < 4 || term.length > 48) return false;
  if (!/^[A-Za-z][A-Za-z0-9'’/ -]*$/.test(term)) return false;
  if (/\b[A-Z]{2,}\b/.test(term) && term.length < 6) return false;
  const words = lower.split(/[ /-]+/).filter(Boolean);
  if (words.length > 3) return false;
  if (words.length === 1 && words[0].length < 5) return false;
  if (words.some((word) => stopDefinitions.has(word))) return false;
  return true;
}

function wordCount(text) {
  return text.split(/[ /-]+/).filter(Boolean).length;
}

function scoreEntry(zh, en) {
  const words = wordCount(en);
  const phraseBonus = words > 1 ? 50 : 0;
  const compactBonus = en.length <= 24 ? 20 : 0;
  return phraseBonus + compactBonus + words * 8 + Math.min(zh.length, 8);
}

const raw = zlib.gunzipSync(fs.readFileSync(sourcePath)).toString('utf8');
const zhToEn = new Map();
const enCandidates = new Map();

for (const rawLine of raw.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[[^\]]+]\s+\/(.+)\/$/);
  if (!match) continue;
  const [, , simplified, definitions] = match;
  if (!isUsefulChineseTerm(simplified)) continue;

  const cleanDefinitions = definitions
    .split('/')
    .map(normalizeDefinition)
    .filter((definition) => definition && !noisyPatterns.some((pattern) => pattern.test(definition)));

  const firstDefinition = cleanDefinitions.find(isUsefulEnglishTerm);
  if (firstDefinition && !zhToEn.has(simplified)) {
    zhToEn.set(simplified, firstDefinition);
  }

  for (const definition of cleanDefinitions) {
    if (!isUsefulEnglishTerm(definition)) continue;
    const key = definition.toLowerCase();
    const next = {
      source: definition,
      target: simplified,
      score: scoreEntry(simplified, definition),
    };
    const current = enCandidates.get(key);
    if (!current || next.score > current.score) {
      enCandidates.set(key, next);
    }
  }
}

const zhEntries = [...zhToEn.entries()]
  .map(([source, target]) => ({ source, target }))
  .sort((a, b) => b.source.length - a.source.length || a.source.localeCompare(b.source, 'zh-Hans-CN'))
  .slice(0, 4000);

const singleWordEnEntries = [...enCandidates.values()]
  .filter(({ source }) => wordCount(source) === 1)
  .sort((a, b) => b.score - a.score || a.source.length - b.source.length)
  .slice(0, 2500);

const phraseEnEntries = [...enCandidates.values()]
  .filter(({ source }) => wordCount(source) > 1)
  .sort((a, b) => b.score - a.score || a.source.length - b.source.length)
  .slice(0, 5500);

const enEntries = [...singleWordEnEntries, ...phraseEnEntries]
  .map(({ source, target }) => ({ source, target }))
  .sort((a, b) => b.source.length - a.source.length || a.source.localeCompare(b.source));

const content = `// Generated from CC-CEDICT (MDBG), licensed under CC BY-SA 4.0.\n// Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict\n// Regenerate with: node scripts/build-cedict-subset.mjs\n\nexport const PUBLIC_EN_TO_ZH_TERMS = ${JSON.stringify(enEntries, null, 2)};\n\nexport const PUBLIC_ZH_TO_EN_TERMS = ${JSON.stringify(zhEntries, null, 2)};\n`;

fs.writeFileSync(outputPath, content);

console.log(`Generated ${enEntries.length} English->Chinese terms and ${zhEntries.length} Chinese->English terms.`);
