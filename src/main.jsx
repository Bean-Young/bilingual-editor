import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlignJustify,
  ArrowRightLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  GripVertical,
  Highlighter,
  Languages,
  Link2,
  MessageSquarePlus,
  PanelRight,
  RotateCcw,
  Save,
  Search,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import './styles.css';

const SAMPLE_SOURCE = String.raw`\section{Introduction}
Large language models have become a practical interface for scientific writing, data analysis, and code generation.

\subsection{Motivation}
Researchers still need a reliable way to keep the English source and Chinese translation aligned during revision.

This editor shows the whole source document and the whole Chinese version side by side. The middle divider can be dragged to resize both panes.

\begin{equation}
  p(y \mid x) = \prod_{t=1}^{T} p(y_t \mid y_{<t}, x)
\end{equation}`;

const dictionary = [
  ['Large language models', '大语言模型'],
  ['language models', '语言模型'],
  ['scientific writing', '科学写作'],
  ['data analysis', '数据分析'],
  ['code generation', '代码生成'],
  ['Researchers', '研究人员'],
  ['reliable way', '可靠方式'],
  ['English source', '英文原稿'],
  ['Chinese version', '中文版本'],
  ['Chinese translation', '中文译文'],
  ['translation', '译文'],
  ['aligned', '对齐'],
  ['revision', '修订'],
  ['editor', '编辑器'],
  ['document', '文档'],
  ['source', '原稿'],
  ['paragraph', '段落'],
  ['heading', '标题'],
  ['equation', '公式'],
  ['comments', '批注'],
  ['attached', '绑定'],
  ['Introduction', '引言'],
  ['Motivation', '研究动机'],
];

const reverseDictionary = dictionary.map(([en, zh]) => [zh, en]);

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
  const masked = text.replace(/(\\begin\{[\s\S]*?\\end\{[^}]+\}|\\[a-zA-Z]+(?:\{[^}]*\})?|\$[^$]*\$)/g, (match) => {
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

function localEnToZh(text) {
  return preserveTexBlocks(text, (input) => {
    let output = input;
    dictionary.forEach(([en, zh]) => {
      output = output.replace(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), zh);
    });
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
    let output = input;
    reverseDictionary.forEach(([zh, en]) => {
      output = output.replaceAll(zh, en);
    });
    return output;
  });
}

function translateText(text, targetLang, sourceLang = 'auto') {
  const resolvedTarget = targetLang === 'auto' ? inferTargetLanguage(text) : targetLang;
  const resolvedSource = sourceLang === 'auto' ? inferSourceLanguage(text) : sourceLang;

  if (resolvedTarget === 'zh-CN') return localEnToZh(text);
  if (resolvedTarget === 'zh-TW') return toTraditional(localEnToZh(text));
  if (resolvedTarget === 'en') return localZhToEn(text);

  const targetLabel = languageLabel(resolvedTarget);
  const base = resolvedSource.startsWith('zh') ? localZhToEn(text) : localEnToZh(text);
  return `[${targetLabel}占位翻译]\n${base}`;
}

function inferSourceLanguage(text) {
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en';
}

function inferTargetLanguage(text) {
  return inferSourceLanguage(text).startsWith('zh') ? 'en' : 'zh-CN';
}

function resolveDirection(text, settings) {
  const sourceLang = settings.sourceLang === 'auto' ? inferSourceLanguage(text) : settings.sourceLang;
  const targetLang = settings.targetLang === 'auto'
    ? (sourceLang.startsWith('zh') ? 'en' : 'zh-CN')
    : settings.targetLang;

  return {
    sourceLang,
    targetLang,
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
  const fileRef = useRef(null);
  const splitAreaRef = useRef(null);

  const stats = useMemo(() => {
    const unresolved = doc.comments.filter((item) => !item.resolved).length;
    return {
      sourceChars: doc.sourceText.length,
      targetChars: doc.targetText.length,
      unresolved,
    };
  }, [doc]);

  const visibleComments = doc.comments;

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

    pushUndoSnapshot();
    setDoc({
      fileName: file.name,
      format,
      savedAt: null,
      sourceText: rawText,
      targetText: translateText(rawText, resolveDirection(rawText, settings).targetLang, resolveDirection(rawText, settings).sourceLang),
      lastEdited: null,
      comments: [],
    });
    setActiveSide('source');
    setStatus(`已导入 ${file.name}`);
    event.target.value = '';
  }

  function updateText(side, value) {
    pushUndoSnapshot();
    setDoc((current) => {
      if (side === 'source') {
        const direction = resolveDirection(value, settings);
        return {
          ...current,
          savedAt: null,
          sourceText: value,
          targetText: syncMode === 'auto' ? translateText(value, direction.targetLang, direction.sourceLang) : current.targetText,
          lastEdited: 'source',
        };
      }
      const direction = resolveDirection(value, settings);
      return {
        ...current,
        savedAt: null,
        targetText: value,
        sourceText: syncMode === 'auto' ? translateText(value, direction.targetLang, direction.sourceLang) : current.sourceText,
        lastEdited: 'target',
      };
    });
    setActiveSide(side);
    setStatus(syncMode === 'auto' ? '已同步另一侧文档' : '已修改，自动同步暂停');
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
        ? translateText(current.sourceText, resolveDirection(current.sourceText, settings).targetLang, resolveDirection(current.sourceText, settings).sourceLang)
        : current.targetText,
      sourceText: direction === 'target'
        ? translateText(current.targetText, resolveDirection(current.targetText, settings).targetLang, resolveDirection(current.targetText, settings).sourceLang)
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
    pushUndoSnapshot();
    setDoc((current) => {
      if (syncMode !== 'auto') return current;
      const direction = resolveDirection(current.sourceText, normalizedSettings);
      return {
        ...current,
        savedAt: null,
        targetText: translateText(current.sourceText, direction.targetLang, direction.sourceLang),
      };
    });
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
    pushUndoSnapshot();
    setDoc((current) => ({
      ...current,
      savedAt: null,
      targetText: translateText(
        current.sourceText,
        resolveDirection(current.sourceText, normalizedSettings).targetLang,
        resolveDirection(current.sourceText, normalizedSettings).sourceLang
      ),
      lastEdited: 'source',
    }));
    setStatus('已互换翻译语言');
  }

  function saveSnapshot() {
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
  const matchCount = search.trim()
    ? [doc.sourceText, doc.targetText].filter((text) => text.toLowerCase().includes(search.trim().toLowerCase())).length
    : null;
  const sourceCommentHighlights = getCommentHighlights(visibleComments, 'source', draftComment);
  const targetCommentHighlights = getCommentHighlights(visibleComments, 'target', draftComment);

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
          <div><strong>{stats.sourceChars}</strong><span>英文字符</span></div>
          <div><strong>{stats.targetChars}</strong><span>中文字符</span></div>
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
              languageLabelText={languageLabel(resolveDirection(doc.sourceText, settings).sourceLang)}
              commentHighlights={sourceCommentHighlights}
              onFocus={() => setActiveSide('source')}
              onSelectionChange={(text, rect) => updateCommentSelection('source', text, rect)}
              onChange={(value) => updateText('source', value)}
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
              languageLabelText={languageLabel(resolveDirection(doc.sourceText, settings).targetLang)}
              commentHighlights={targetCommentHighlights}
              onFocus={() => setActiveSide('target')}
              onSelectionChange={(text, rect) => updateCommentSelection('target', text, rect)}
              onChange={(value) => updateText('target', value)}
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
          onChange={applySettings}
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

function DocumentPane({ title, side, paneId, format, icon, text, active, dirty, languageLabelText, commentHighlights, onFocus, onSelectionChange, onChange, onExportText }) {
  const [viewMode, setViewMode] = useState('rendered');

  function updateRendered(event) {
    const nextText = serializeRenderedDocument(event.currentTarget, format);
    if (nextText && nextText !== text.trim()) {
      onChange(nextText);
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
            <button className={viewMode === 'raw' ? 'active' : ''} onClick={() => setViewMode('raw')}>原稿</button>
            <button className={viewMode === 'rendered' ? 'active' : ''} onClick={() => setViewMode('rendered')}>渲染</button>
          </div>
          <button className="icon-action" title="导出文本" onClick={onExportText}><Download size={15} /></button>
        </div>
      </div>

      <div className="document-surface" onClick={onFocus}>
        {viewMode === 'raw' ? (
          <textarea
            className="whole-textarea"
            value={text}
            onFocus={onFocus}
            onSelect={captureTextareaSelection}
            onMouseUp={captureTextareaSelection}
            onKeyUp={captureTextareaSelection}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={side === 'source'}
          />
        ) : (
          <RenderedDocument
            text={text}
            side={paneId}
            commentHighlights={commentHighlights}
            editable
            onFocus={onFocus}
            onMouseUp={captureRenderedSelection}
            onKeyUp={captureRenderedSelection}
            onBlur={updateRendered}
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

function SettingsPanel({ settings, onChange, onClose }) {
  function update(patch) {
    onChange({ ...settings, ...patch });
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <strong>设置</strong>
            <span>主题与翻译方向</span>
          </div>
          <button onClick={onClose} title="关闭"><X size={16} /></button>
        </div>

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

      </section>
    </div>
  );
}

function RenderedDocument({ text, side, commentHighlights = [], editable = false, onFocus, onBlur }) {
  const blocks = renderBlocks(text);
  let headingIndex = 0;
  return (
    <div
      className="rendered-body document-rendered"
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck
      onFocus={onFocus}
      onBlur={onBlur}
      role={editable ? 'textbox' : undefined}
      aria-multiline={editable ? 'true' : undefined}
    >
      {blocks.map((block, index) => {
        if (block.type === 'h1') {
          headingIndex += 1;
          return <h2 key={index} data-side={side} data-heading-id={`heading-${headingIndex}`}>{renderInline(block.text, commentHighlights)}</h2>;
        }
        if (block.type === 'h2') {
          headingIndex += 1;
          return <h3 key={index} data-side={side} data-heading-id={`heading-${headingIndex}`}>{renderInline(block.text, commentHighlights)}</h3>;
        }
        if (block.type === 'equation') return <pre key={index} className="rendered-equation">{block.text}</pre>;
        if (block.type === 'list') return <p key={index} className="rendered-list">{renderInline(block.text, commentHighlights)}</p>;
        return <p key={index}>{renderInline(block.text, commentHighlights)}</p>;
      })}
    </div>
  );
}

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
    const containingQuote = highlights.find((quote) => quote.toLowerCase().includes(trimmedText.toLowerCase()));
    if (containingQuote && containingQuote.length > trimmedText.length) {
      return <mark className="comment-highlight">{text}</mark>;
    }
  }

  const parts = [];
  const lowerText = text.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    let nextMatch = null;
    highlights.forEach((quote) => {
      const index = lowerText.indexOf(quote.toLowerCase(), cursor);
      if (index === -1) return;
      if (!nextMatch || index < nextMatch.index || (index === nextMatch.index && quote.length > nextMatch.quote.length)) {
        nextMatch = { index, quote };
      }
    });

    if (!nextMatch) {
      parts.push(text.slice(cursor));
      break;
    }

    if (nextMatch.index > cursor) {
      parts.push(text.slice(cursor, nextMatch.index));
    }

    const end = nextMatch.index + nextMatch.quote.length;
    parts.push(
      <mark key={`${nextMatch.index}-${end}-${parts.length}`} className="comment-highlight">
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

createRoot(document.getElementById('root')).render(<App />);
