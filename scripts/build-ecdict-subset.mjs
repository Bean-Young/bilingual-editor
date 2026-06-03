import fs from 'node:fs';

const sourcePath = new URL('../data/dictionaries/ecdict.csv', import.meta.url);
const outputPath = new URL('../src/translation/publicEcdictTerms.js', import.meta.url);

const maxSingleWordEntries = 20000;
const maxPhraseEntries = 30000;
const maxDomainPhraseEntries = 30000;
const maxCommonPhraseEntries = 50000;

const noisyTranslationPatterns = [
  /^\[/,
  /人名/,
  /地名/,
  /网络/,
  /音标/,
  /缩写/,
  /同义词/,
  /反义词/,
  /复数/,
  /过去式/,
  /比较级/,
  /最高级/,
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function cleanWord(word) {
  return word
    .trim()
    .replace(/[’]/g, "'")
    .toLowerCase();
}

function isUsefulWord(word) {
  if (!word || word.length > 36) return false;
  if (!/^[a-z][a-z' -]*$/.test(word)) return false;
  if (word.startsWith('-') || word.startsWith("'")) return false;
  const parts = word.split(/[ -]+/).filter(Boolean);
  if (parts.length > 3) return false;
  if (parts.some((part) => part.length < 2)) return false;
  return true;
}

function segmentScore(segment) {
  let score = 0;
  if (/\baux\./i.test(segment)) score += 45;
  if (/\b(prep|conj)\./i.test(segment)) score += 38;
  if (/\b(vt|vi)\./i.test(segment)) score += 32;
  if (/\b(a|adv|adj)\./i.test(segment)) score += 24;
  if (/\bn\./i.test(segment)) score += 18;
  if (/\[(计|经|医|法)]/.test(segment)) score += 8;
  return score;
}

function cleanChineseCandidate(value) {
  return value
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b[a-z]\.\s*/gi, ' ')
    .replace(/\b(vt|vi|n|a|adv|adj|prep|conj|aux|pron|num|int)\.\s*/gi, ' ')
    .replace(/[A-Za-z0-9_.…·()（）]+/g, ' ')
    .replace(/[“”"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTarget(translation) {
  const candidates = new Map();
  for (const segment of translation.split(/\\n|\n+/)) {
    const baseScore = segmentScore(segment);
    const isFunctionSegment = /\b(aux|prep|conj)\./i.test(segment);
    for (const rawCandidate of segment.split(/[;；,，/]+/)) {
      const candidate = cleanChineseCandidate(rawCandidate);
      if (!candidate || !/[\u3400-\u9fff]/.test(candidate)) continue;
      if (candidate.length < 1 || candidate.length > 12) continue;
      if (noisyTranslationPatterns.some((pattern) => pattern.test(candidate))) continue;
      const current = candidates.get(candidate) ?? { target: candidate, score: 0, count: 0, repeatEligible: false };
      const candidateScore = baseScore + (candidate.length <= 4 ? 8 : 0);
      current.score = isFunctionSegment
        ? Math.max(current.score, candidateScore)
        : current.score + candidateScore;
      current.count += 1;
      current.repeatEligible = current.repeatEligible || !isFunctionSegment;
      candidates.set(candidate, current);
    }
  }

  const ranked = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + (candidate.repeatEligible ? Math.max(0, candidate.count - 1) * 24 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.target.length - b.target.length);
  return ranked[0] ?? null;
}

function scoreEntry(row, word, targetScore) {
  const collins = Number(row.collins || 0);
  const oxford = row.oxford ? 1 : 0;
  const frequency = Number(row.frq || row.bnc || 999999);
  const phraseBonus = word.includes(' ') ? 40 : 0;
  const domainPhraseBonus = word.includes(' ') && /\[(计|经|医|法)]/.test(row.translation ?? '') ? 180 : 0;
  return collins * 100 + oxford * 60 + phraseBonus + domainPhraseBonus + targetScore - Math.min(frequency, 50000) / 1000;
}

if (!fs.existsSync(sourcePath)) {
  throw new Error('Missing data/dictionaries/ecdict.csv. Download from https://github.com/skywind3000/ECDICT before running this script.');
}

const rows = parseCsv(fs.readFileSync(sourcePath, 'utf8'));
const header = rows.shift();
const fieldIndex = Object.fromEntries(header.map((name, index) => [name, index]));
const entries = new Map();

for (const row of rows) {
  const record = Object.fromEntries(Object.entries(fieldIndex).map(([name, index]) => [name, row[index] ?? '']));
  const source = cleanWord(record.word ?? '');
  if (!isUsefulWord(source)) continue;

  const targetCandidate = extractTarget(record.translation ?? '');
  if (!targetCandidate) continue;

  const entry = {
    source,
    target: targetCandidate.target,
    score: scoreEntry(record, source, targetCandidate.score),
    domainPhrase: source.includes(' ') && /\[(计|经|医|法)]/.test(record.translation ?? ''),
  };
  const current = entries.get(source);
  if (!current || entry.score > current.score) {
    entries.set(source, entry);
  }

  for (const exchangeItem of String(record.exchange ?? '').split('/')) {
    const [, variantValue] = exchangeItem.split(':');
    if (!variantValue) continue;
    for (const variant of variantValue.split(',')) {
      const variantSource = cleanWord(variant);
      if (!isUsefulWord(variantSource)) continue;
      const variantEntry = {
        ...entry,
        source: variantSource,
        score: entry.score - 1,
      };
      const currentVariant = entries.get(variantSource);
      if (!currentVariant || variantEntry.score > currentVariant.score) {
        entries.set(variantSource, variantEntry);
      }
    }
  }
}

const singleWordEntries = [...entries.values()]
  .filter(({ source }) => !source.includes(' '))
  .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))
  .slice(0, maxSingleWordEntries);

const commonSingleWords = new Set(singleWordEntries.map(({ source }) => source));
const commonSingleRanks = new Map(singleWordEntries.map(({ source }, index) => [source, index + 1]));

const domainPhraseEntries = [...entries.values()]
  .filter(({ source, domainPhrase }) => source.includes(' ') && domainPhrase)
  .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))
  .slice(0, maxDomainPhraseEntries);

const phraseEntries = [...entries.values()]
  .filter(({ source }) => source.includes(' '))
  .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))
  .slice(0, maxPhraseEntries);

const commonPhraseEntries = [...entries.values()]
  .filter(({ source }) => source.includes(' '))
  .filter(({ source }) => source.split(/[ -]+/).every((part) => commonSingleWords.has(part)))
  .sort((a, b) => {
    const rankA = a.source.split(/[ -]+/).reduce((sum, part) => sum + (commonSingleRanks.get(part) ?? 99999), 0);
    const rankB = b.source.split(/[ -]+/).reduce((sum, part) => sum + (commonSingleRanks.get(part) ?? 99999), 0);
    return rankA - rankB || b.score - a.score || a.source.localeCompare(b.source);
  })
  .slice(0, maxCommonPhraseEntries);

const seenOutputSources = new Set();
const outputEntries = [];
for (const { source, target } of [...singleWordEntries, ...domainPhraseEntries, ...commonPhraseEntries, ...phraseEntries]) {
  if (seenOutputSources.has(source)) continue;
  seenOutputSources.add(source);
  outputEntries.push({ source, target });
}
outputEntries.sort((a, b) => b.source.length - a.source.length || a.source.localeCompare(b.source));

const content = `// Generated from ECDICT, licensed under MIT.\n// Source: https://github.com/skywind3000/ECDICT\n// Regenerate with: node scripts/build-ecdict-subset.mjs\n\nexport const ECDICT_EN_TO_ZH_TERMS = ${JSON.stringify(outputEntries, null, 2)};\n`;

fs.writeFileSync(outputPath, content);
console.log(`Generated ${outputEntries.length} English->Chinese terms from ECDICT.`);
