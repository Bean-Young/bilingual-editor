import assert from 'node:assert/strict';
import { ECDICT_EN_TO_ZH_TERMS } from '../src/translation/publicEcdictTerms.js';
import { PUBLIC_EN_TO_ZH_TERMS, PUBLIC_ZH_TO_EN_TERMS } from '../src/translation/publicZhEnTerms.js';

const uiEnZhFallbackTerms = [
  { source: 'large language models', target: '大型语言模型' },
  { source: 'large language model', target: '大型语言模型' },
  { source: 'hello', target: '你好' },
];

const uiZhEnFallbackTerms = [
  { source: '大型语言模型', target: 'large language models' },
  { source: '大语言模型', target: 'large language models' },
  { source: '语言模型', target: 'language models' },
  { source: '你好', target: 'hello' },
];

const enToZhTerms = buildTermList([...uiEnZhFallbackTerms, ...PUBLIC_EN_TO_ZH_TERMS, ...ECDICT_EN_TO_ZH_TERMS], 'en');
const zhToEnTerms = buildTermList([...uiZhEnFallbackTerms, ...PUBLIC_ZH_TO_EN_TERMS], 'zh');

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
    if (source && target && output.includes(source)) output = output.replaceAll(source, ` ${target} `);
  });
  return output.replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?，。；：！？])/g, '$1').trim();
}

function localEnToZh(text) {
  return applyEnglishTerms(text, enToZhTerms);
}

function localZhToEn(text) {
  return applyChineseTerms(text, zhToEnTerms);
}

function sanitizeLlmPatchTranslation(translatedPatch, addedText, localPatch, direction) {
  const patch = String(translatedPatch ?? '').trim();
  const fallback = String(localPatch ?? '').trim();
  if (!patch) return fallback;
  if (!fallback) return patch;

  const added = String(addedText ?? '').trim();
  const copiedSourceText = added && patch.toLowerCase().includes(added.toLowerCase());
  const targetIsChinese = direction.targetLang === 'zh-CN' || direction.targetLang === 'zh-TW';
  const fallbackIsChinese = /[\u3400-\u9fff]/.test(fallback);
  const patchHasLatin = /[A-Za-z]{2,}/.test(patch);

  if (copiedSourceText) return fallback;
  if (targetIsChinese && fallbackIsChinese && patchHasLatin) return fallback;
  return patch;
}

function commentHighlightCandidates(comment, side) {
  const active = comment[side];
  const otherSide = side === 'source' ? 'target' : 'source';
  const other = comment[otherSide];
  return [
    active.quote,
    otherSide === 'source' ? localEnToZh(other.quote) : localZhToEn(other.quote),
  ].map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

assert.equal(localEnToZh('hello'), '你好', 'realtime local en->zh patch should translate hello');
assert.equal(localZhToEn('你好'), 'hello', 'realtime local zh->en patch should translate 你好');
assert.equal(
  sanitizeLlmPatchTranslation('hello', 'hello', '你好', { targetLang: 'zh-CN' }),
  '你好',
  'Kimi patch returning source text must be corrected to the local target-language patch'
);

const candidates = commentHighlightCandidates({
  source: { quote: 'Large language models', text: 'Check terminology.' },
  target: { quote: '大件 文辞 模型', text: '术语检查。' },
}, 'target');
assert.ok(
  candidates.some((item) => item.includes('大型语言模型')),
  `comment candidates should include 大型语言模型, got ${JSON.stringify(candidates)}`
);

console.log('regression tests passed');
