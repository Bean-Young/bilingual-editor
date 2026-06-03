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
import { ECDICT_EN_TO_ZH_TERMS } from './translation/publicEcdictTerms';
import { PUBLIC_EN_TO_ZH_TERMS, PUBLIC_ZH_TO_EN_TERMS } from './translation/publicZhEnTerms';
import './styles.css';

const SAMPLE_SOURCE = String.raw`\section{Introduction}
Large language models have become a practical interface for scientific writing, data analysis, and code generation.

\subsection{Motivation}
Researchers still need a reliable way to keep the English source and Chinese translation aligned during revision.

This editor shows the whole source document and the whole Chinese version side by side. The middle divider can be dragged to resize both panes.

\begin{equation}
  p(y \mid x) = \prod_{t=1}^{T} p(y_t \mid y_{<t}, x)
\end{equation}`;

const enToZhTerms = buildTermList([...ECDICT_EN_TO_ZH_TERMS, ...PUBLIC_EN_TO_ZH_TERMS], 'en');
const zhToEnTerms = buildTermList(PUBLIC_ZH_TO_EN_TERMS, 'zh');

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
};

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

const traditionalMap = {
  大: '大',
  语: '語',
  言: '言',
  模: '模',
  型: '型',
  科: '科',
  学: '學',
  写: '寫',
  作: '作',
  数: '數',
  据: '據',
  分: '分',
  析: '析',
  代: '代',
  码: '碼',
  生: '生',
  成: '成',
  文: '文',
  档: '檔',
  简: '簡',
  体: '體',
  译: '譯',
  对: '對',
  调: '調',
  整: '整',
  两: '兩',
  侧: '側',
  动: '動',
};

function preserveTexBlocks(text, transform) {
  const blocks = [];
  const protectedTexPattern = /(\\begin\{[\s\S]*?\\end\{[^}]+\}|\$[^$]*\$|\\(?:cite|citep|citet|ref|eqref|autoref|cref|label|url|href|includegraphics|bibliography|bibliographystyle)(?:\[[^\]]*])?(?:\{[^}]*\})+)/g;
  const masked = text.replace(protectedTexPattern, (match) => {
    const key = `__TEX_${blocks.length}__`;
    blocks.push(match);
    return key;
  });
  let result = transform(masked);
  blocks.forEach((block, index) => {
    result = result.replace(`__TEX_${index}__`, block);
  });
  return result;
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

function localEnToZh(text) {
  return preserveTexBlocks(text, (input) => {
    let output = input;
    output = applyEnglishTerms(output, enToZhTerms);
    return output
      .replace(/\bhas become\b/gi, '已经成为')
      .replace(/\bstill need\b/gi, '仍然需要')
      .replace(/\bshows\b/gi, '显示')
      .replace(/\bside by side\b/gi, '并排')
      .replace(/\bcan be dragged\b/gi, '可以拖动')
      .replace(/\bto resize both panes\b/gi, '来调整两侧大小');
  });
}

function localZhToEn(text) {
  return preserveTexBlocks(text, (input) => {
    return applyChineseTerms(input, zhToEnTerms);
  });
}

function sanitizeEnglishTranslation(text) {
  return preserveTexBlocks(text, (input) => input
    .replace(/[，]/g, ', ')
    .replace(/[。]/g, '.')
    .replace(/[；]/g, '; ')
    .replace(/[：]/g, ': ')
    .replace(/[！？]/g, (match) => (match === '！' ? '!' : '?'))
    .replace(/[、]/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[（）]/g, (match) => (match === '（' ? '(' : ')'))
    .replace(/[和与及]/g, ' and ')
    .replace(/[或]/g, ' or ')
    .replace(/[的地得了着过于为]/g, ' ')
    .replace(/[\u3400-\u9fff]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([({[])\s+/g, '$1')
    .replace(/\s+([)}\]])/g, '$1')
    .replace(/\n[ \t]+/g, '\n')
    .trim());
}

function translateText(text, targetLang, sourceLang = 'auto') {
  const resolvedTarget = targetLang === 'auto' ? inferTargetLanguage(text) : targetLang;
  const resolvedSource = sourceLang === 'auto' ? inferSourceLanguage(text) : sourceLang;

  if (resolvedTarget === 'zh-CN') return localEnToZh(text);
  if (resolvedTarget === 'zh-TW') return toTraditional(localEnToZh(text));
  if (resolvedTarget === 'en') return sanitizeEnglishTranslation(localZhToEn(text));

  const targetLabel = languageLabel(resolvedTarget);
  const base = resolvedSource.startsWith('zh') ? localZhToEn(text) : localEnToZh(text);
  return `[${targetLabel}占位翻译]\n${base}`;
}

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

function translateForSync(text, side, settings, fallbackText) {
  const direction = resolveSideDirection(text, side, settings);
  if (sameLanguageGroup(direction.sourceLang, direction.targetLang)) {
    return fallbackText;
  }
  return translateText(text, direction.targetLang, direction.sourceLang);
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

function mergeEditedSyncBlocks(previousActiveText, nextActiveText, previousPassiveText, side, settings) {
  if (previousActiveText === nextActiveText) return previousPassiveText;

  const previousActiveBlocks = segmentSyncBlocks(previousActiveText);
  const nextActiveBlocks = segmentSyncBlocks(nextActiveText);
  const previousPassiveBlocks = segmentSyncBlocks(previousPassiveText);
  const unchangedMap = mapUnchangedBlocks(previousActiveBlocks, nextActiveBlocks);

  return nextActiveBlocks
    .map((block, index) => {
      const previousIndex = unchangedMap.get(index);
      const passiveText = previousIndex === undefined
        ? translateForSync(block.text, side, settings, '')
        : previousPassiveBlocks[previousIndex]?.text ?? translateForSync(block.text, side, settings, '');
      return `${passiveText}${block.separator}`;
    })
    .join('');
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

function toTraditional(text) {
  return text.replace(/[大语言模型科学写作数据代码文档简体译对调整两侧动]/g, (char) => traditionalMap[char] ?? char);
}

function makePairedCommentText(text, side, kind) {
  if (!text) return '';
  const converted = side === 'source' ? localEnToZh(text) : localZhToEn(text);
  if (converted === text && kind === 'text') {
    return side === 'source' ? `译文侧：${text}` : `Source side: ${text}`;
  }
  return converted;
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
  const targetText = translateText(SAMPLE_SOURCE, 'zh-CN', 'en');
  return {
    fileName: 'sample-paper.tex',
    format: 'tex',
    savedAt: null,
    sourceText: SAMPLE_SOURCE,
    targetText,
    lastEdited: null,
    comments: [
      {
        id: crypto.randomUUID(),
        source: {
          text: 'You can keep terminology, style, or review notes here.',
          quote: 'Large language models',
        },
        target: {
          text: '这里可以记录术语、句式或审稿意见。',
          quote: '大语言模型',
        },
        resolved: false,
        createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      },
    ],
  };
}

function classNames(...names) {
  return names.filter(Boolean).join(' ');
}

function isSupportedLanguage(code) {
  return LANGUAGES.some((language) => language.code === code);
}

function settingsFromProfile(profile, fallbackSettings) {
  const sourceLang = isSupportedLanguage(profile.default_source_lang) ? profile.default_source_lang : fallbackSettings.sourceLang;
  const targetLang = isSupportedLanguage(profile.default_target_lang) ? profile.default_target_lang : fallbackSettings.targetLang;
  const profileHue = Number(profile.theme_hue);
  return {
    ...fallbackSettings,
    accentHue: Number.isFinite(profileHue) ? profileHue : fallbackSettings.accentHue,
    sourceLang,
    targetLang,
    autoDetect: sourceLang === 'auto' && targetLang === 'auto',
  };
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

function normalizePresenceUsers(presenceState) {
  const users = Object.values(presenceState)
    .flat()
    .filter((item) => item?.userId && item?.email);
  return [...new Map(users.map((item) => [item.userId, item])).values()]
    .sort((a, b) => a.email.localeCompare(b.email));
}

function App() {
  const [doc, setDoc] = useState(createInitialState);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSide, setActiveSide] = useState('source');
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [syncMode, setSyncMode] = useState('auto');
  const [status, setStatus] = useState('已加载示例文档');
  const [leftWidth, setLeftWidth] = useState(50);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [selectedCommentText, setSelectedCommentText] = useState({ side: null, text: '', rect: null });
  const [draftComment, setDraftComment] = useState(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '', displayName: '' });
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [cloudDocs, setCloudDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(isSupabaseConfigured ? '等待登录' : '本地模式');
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
  const remoteUpdateRef = useRef(false);

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
  const currentUser = session?.user ?? null;
  const cloudEnabled = isSupabaseConfigured && Boolean(currentUser);
  const userDisplayName = profile?.display_name || currentUser?.user_metadata?.display_name || DEFAULT_DISPLAY_NAME;

  function pushUndoSnapshot(snapshot = doc) {
    setUndoSnapshot(snapshot);
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
    if (!isSupabaseConfigured) return undefined;
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

  useEffect(() => () => window.clearTimeout(profileTimerRef.current), []);

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
      targetText: translateForSync(rawText, 'source', settings, ''),
      lastEdited: null,
      comments: [],
    };

    pushUndoSnapshot();
    setDoc(nextDoc);
    setActiveSide('source');
    setStatus(`已导入 ${file.name}`);
    if (cloudEnabled) {
      await createCloudDocument(nextDoc);
    }
    event.target.value = '';
  }

  function updateText(side, value, options = {}) {
    const shouldSync = options.sync !== false && syncMode === 'auto';
    if (options.pushUndo !== false) {
      pushUndoSnapshot();
    }
    setDoc((current) => {
      if (side === 'source') {
        return {
          ...current,
          savedAt: null,
          sourceText: value,
          targetText: shouldSync
            ? mergeEditedSyncBlocks(current.sourceText, value, current.targetText, 'source', settings)
            : current.targetText,
          lastEdited: 'source',
        };
      }
      return {
        ...current,
        savedAt: null,
        targetText: value,
        sourceText: shouldSync
          ? mergeEditedSyncBlocks(current.targetText, value, current.sourceText, 'target', settings)
          : current.sourceText,
        lastEdited: 'target',
      };
    });
    setActiveSide(side);
    setStatus(syncMode === 'auto' ? '已同步另一侧文档' : '已修改，自动同步暂停');
  }

  function previewText(side, value) {
    setDoc((current) => {
      if (side === 'source') {
        return {
          ...current,
          savedAt: null,
          targetText: syncMode === 'auto'
            ? mergeEditedSyncBlocks(current.sourceText, value, current.targetText, 'source', settings)
            : current.targetText,
          lastEdited: 'source',
        };
      }
      return {
        ...current,
        savedAt: null,
        sourceText: syncMode === 'auto'
          ? mergeEditedSyncBlocks(current.targetText, value, current.sourceText, 'target', settings)
          : current.sourceText,
        lastEdited: 'target',
      };
    });
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
    const passiveText = side === 'source' ? doc.targetText : doc.sourceText;
    const quote = draftComment.quote;
    const pairedQuote = makePairedCommentText(quote, side, 'quote');
    const pairedText = makePairedCommentText(text, side, 'text');
    pushUndoSnapshot();
    setDoc((current) => ({
      ...current,
      comments: [
        {
          id: crypto.randomUUID(),
          source: side === 'source'
            ? { text, quote }
            : { text: pairedText, quote: pairedQuote || passiveText.slice(0, 80) },
          target: side === 'target'
            ? { text, quote }
            : { text: pairedText, quote: pairedQuote || passiveText.slice(0, 80) },
          resolved: false,
          createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        },
        ...current.comments,
      ],
    }));
    setDraftComment(null);
    setStatus('已添加批注');
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

  function syncAll(direction) {
    pushUndoSnapshot();
    setDoc((current) => ({
      ...current,
      savedAt: null,
      targetText: direction === 'source'
        ? translateForSync(current.sourceText, 'source', settings, current.targetText)
        : current.targetText,
      sourceText: direction === 'target'
        ? translateForSync(current.targetText, 'target', settings, current.sourceText)
        : current.sourceText,
      lastEdited: direction,
    }));
    setStatus(direction === 'source' ? '已按左侧文档重建右侧' : '已按右侧文档重建左侧');
  }

  function applySettings(nextSettings) {
    const normalizedSettings = {
      ...nextSettings,
      autoDetect: nextSettings.sourceLang === 'auto' && nextSettings.targetLang === 'auto',
    };
    setSettings(normalizedSettings);
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
    const normalizedSettings = {
      ...nextSettings,
      autoDetect: nextSettings.sourceLang === 'auto' && nextSettings.targetLang === 'auto',
    };
    setSettings(normalizedSettings);
    scheduleProfileSave(normalizedSettings);
    setStatus('已互换翻译语言');
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
    setStatus('已保存到浏览器本地');
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
    () => getSearchState(doc.sourceText, doc.targetText, search),
    [doc.sourceText, doc.targetText, search]
  );
  const matchCount = searchState.query ? searchState.totalMatches : null;
  const sourceCommentHighlights = getCommentHighlights(visibleComments, 'source', draftComment);
  const targetCommentHighlights = getCommentHighlights(visibleComments, 'target', draftComment);

  if (!authReady) {
    return <div className="loading-screen">正在连接云端...</div>;
  }

  if (isSupabaseConfigured && !session) {
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
                  <span>配置 Supabase 后启用注册、登录和协作。</span>
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
              <span>{doc.savedAt ? `本地保存 ${doc.savedAt}` : status}</span>
            </div>
          </div>
          <div className="toolbar">
            <div className="search-box">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索正文或译文" />
              {matchCount !== null && <em>{matchCount}</em>}
            </div>
            <button className={classNames(syncMode === 'auto' && 'active')} onClick={() => setSyncMode(syncMode === 'auto' ? 'manual' : 'auto')}>
              <Link2 size={16} />
              {syncMode === 'auto' ? '自动同步' : '手动同步'}
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
              text={doc.sourceText}
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
              onPreviewChange={(value) => previewText('source', value)}
              onExportText={() => exportText('source')}
            />

            <button className="split-handle" onPointerDown={startResize} title="拖动调整左右宽度" aria-label="拖动调整左右宽度">
              <GripVertical size={18} />
            </button>

            <DocumentPane
              title="译文"
              side="target"
              icon={<Languages size={17} />}
              text={doc.targetText}
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
              onPreviewChange={(value) => previewText('target', value)}
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
  const inlineHighlights = buildInlineHighlights(commentHighlights, searchHighlights);

  function commitRenderedEdit(element = renderedRef.current) {
    if (!element || viewMode !== 'rendered') return;
    if (!renderedDirtyRef.current) return;
    const nextText = serializeRenderedDocument(element, format);
    renderedDirtyRef.current = false;
    if (nextText !== text.trim()) {
      onChange(nextText, { sync: false });
    }
  }

  function previewRenderedEdit(event) {
    renderedDirtyRef.current = true;
    const nextText = serializeRenderedDocument(event.currentTarget, format);
    if (nextText !== text.trim()) {
      onPreviewChange(nextText);
    }
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
            key={`${paneId}:${text}`}
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
          中英术语层使用 CC-CEDICT 公开词典子集，按 CC BY-SA 4.0 授权。
        </p>

      </section>
    </div>
  );
}

const RenderedDocument = React.forwardRef(function RenderedDocument({
  text,
  side,
  commentHighlights = [],
  searchHighlights = [],
  searchMatchBlockIndexes = new Set(),
  searchRelatedBlockIndexes = new Set(),
  editable = false,
  onFocus,
  onInput,
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
});

function serializeRenderedDocument(root, format) {
  const blocks = Array.from(root.children)
    .map((element) => {
      const text = element.innerText.replace(/\u00a0/g, ' ').trim();
      if (!text) return '';

      if (element.matches('h2')) {
        if (format === 'tex') return `\\section{${text}}`;
        if (format === 'md') return `# ${text}`;
        return text;
      }

      if (element.matches('h3')) {
        if (format === 'tex') return `\\subsection{${text}}`;
        if (format === 'md') return `## ${text}`;
        return text;
      }

      if (element.matches('pre')) {
        if (format === 'tex') return `\\begin{equation}\n  ${text}\n\\end{equation}`;
        if (format === 'md') return `$$\n${text}\n$$`;
        return text;
      }

      return text;
    })
    .filter(Boolean);

  return blocks.length ? blocks.join('\n\n') : root.innerText.trim();
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

function buildSearchTerms(query, side) {
  const paired = side === 'source' ? localZhToEn(query) : localEnToZh(query);
  const traditional = side === 'target' ? toTraditional(paired) : paired;
  return uniqueSearchTerms([query, paired, traditional])
    .sort((a, b) => b.length - a.length);
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
  const quotes = comments
    .filter((comment) => !comment.resolved)
    .map((comment) => (comment[side] ?? legacyCommentSide(comment, side)).quote)
    .filter(Boolean);

  if (draft?.quote) {
    quotes.push(draft.side === side ? draft.quote : makePairedCommentText(draft.quote, draft.side, 'quote'));
  }

  return [...new Set(quotes.map((quote) => quote.trim()).filter((quote) => quote.length >= 2))]
    .sort((a, b) => b.length - a.length);
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
  const trimmedText = text.trim();
  if (trimmedText.length >= 6) {
    const containingQuote = highlights.find((highlight) => highlight.text.toLowerCase().includes(trimmedText.toLowerCase()));
    if (containingQuote && containingQuote.text.length > trimmedText.length) {
      return <mark className={containingQuote.className}>{text}</mark>;
    }
  }

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
        {comments.length === 0 && !draft && (
          <div className="empty-comments">
            <Highlighter size={22} />
            <strong>暂无批注</strong>
            <span>选中文本或切换到对应文档后添加审阅意见。</span>
          </div>
        )}
        {comments.map((comment) => {
          const display = comment[activeSide] ?? legacyCommentSide(comment, activeSide);
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
  const quote = draft.side === activeSide
    ? draft.quote
    : makePairedCommentText(draft.quote, draft.side, 'quote');

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
  if (activeSide === 'source') {
    return {
      text: comment.side === 'target' ? localZhToEn(text) : text,
      quote: comment.side === 'target' ? localZhToEn(quote) : quote,
    };
  }
  return {
    text: comment.side === 'source' ? localEnToZh(text) : text,
    quote: comment.side === 'source' ? localEnToZh(quote) : quote,
  };
}

const rootElement = document.getElementById('root');
const appRoot = rootElement.__bilingualEditorRoot ?? createRoot(rootElement);
rootElement.__bilingualEditorRoot = appRoot;
appRoot.render(<App />);
