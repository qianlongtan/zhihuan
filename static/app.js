/**
 * 知幻 · 应用入口：组装顶栏、阅读视图、译文面板、设置弹窗。
 */
import { ICONS } from './icons.js';
import { toast } from './toast.js';
import { PdfView } from './pdfview.js';
import { TranslatePanel } from './panel.js';
import { SettingsModal } from './settings.js';
import { AnnotManager } from './annot.js';

const $ = (id) => document.getElementById(id);

// 图标注入
document.querySelectorAll('[data-icon]').forEach((el) => {
  el.innerHTML = ICONS[el.dataset.icon] || '';
});

// ─────────────────────────── 状态

const state = {
  auto: localStorage.getItem('zh.auto') !== '0',
  settings: null,
  meta: null,
  fileName: '',
  originalBytes: null,  // 打开时的原始 PDF 字节（保存时永远从它重建，不回读文件）
  handle: null,         // FileSystemFileHandle（showOpenFilePicker 才有）
};

// ─────────────────────────── 阅读视图

const reader = $('reader');
const pagesEl = $('pages');
const panelEl = $('panel');

const panel = new TranslatePanel();

let annots = null; // PdfView 之后创建（hook 运行时已就位）

const view = new PdfView(reader, pagesEl, {
  onSelect(sel) {
    if (panelEl.dataset.view === 'notes') switchTab('trans'); // 划词即回翻译视图
    panel.onSelect({ text: sel.text, page: sel.page, auto: state.auto });
    annots?.onSelection(sel);
  },
  onSelectEmpty() {
    annots?.onSelectEmpty();
  },
  onPageRender(n) {
    annots?.renderPage(n);
  },
  onPage(n, total) {
    $('pageInput').value = n;
    $('pageTotal').textContent = `/ ${total}`;
  },
  onScale(s) {
    $('zoomReset').textContent = Math.round(s * 100) + '%';
    annots?.onScaleChange();
  },
});

annots = new AnnotManager(view, {
  onChange(list) {
    const n = list.length;
    const el = $('notesCount');
    el.textContent = n;
    el.hidden = n === 0;
    if (panelEl.dataset.view === 'notes') annots.renderNotes($('notesPane'));
  },
  onDirty() {
    $('saveDot').hidden = false;
  },
  onSaved() {
    $('saveDot').hidden = true;
  },
});

// ─────────────────────────── 打开文件

async function openFile(file, handle = null) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('请选择 PDF 文件', 'error');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    // 原始字节单独留一份：保存时永远从它重建（writeAnnotations 会写入文件，
    // 若回读已带注释的文件再写，同批注释会重复堆叠）。pdf.js 可能分离 buf，故先拷贝。
    state.originalBytes = new Uint8Array(buf.slice(0));
    state.handle = handle;
    $('empty').hidden = true;
    $('pages').hidden = false;
    state.fileName = file.name;
    document.title = `${file.name} · 知幻`;
    panel.clear();
    await view.load(buf);
    await annots.setDoc({ fileName: file.name, size: file.size, lastModified: file.lastModified });
    $('saveDot').hidden = true;
    toast(`已打开 ${file.name}（${view.numPages} 页）`, 'success');
  } catch (err) {
    console.error(err);
    $('empty').hidden = false;
    $('pages').hidden = true;
    state.originalBytes = null;
    state.handle = null;
    annots.clear();
    toast(`打开失败：${err.message || err}`, 'error', 5000);
  }
}

/** 打开：优先 File System Access（拿得到句柄才能原位覆盖），否则回退 <input> */
async function pickFile() {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      await openFile(file, handle);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 用户取消
      console.warn('[open] showOpenFilePicker 失败，回退文件选择框：', err);
      // 落到 input 分支
    }
  }
  $('fileInput').click();
}

$('btnOpen').addEventListener('click', pickFile);
$('btnPick').addEventListener('click', pickFile);
$('fileInput').addEventListener('change', (e) => {
  openFile(e.target.files?.[0], null); // 文件框拿不到句柄
  e.target.value = '';
});

// 拖放（窗口任意位置）
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if ([...e.dataTransfer.types].includes('Files')) {
    dragDepth++;
    $('dropOverlay').hidden = false;
    document.body.classList.add('drag-over');
  }
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    $('dropOverlay').hidden = true;
    document.body.classList.remove('drag-over');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  document.body.classList.remove('drag-over');
  const file = [...(e.dataTransfer?.files || [])].find(
    (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
  );
  if (file) openFile(file);
  else if (e.dataTransfer?.files?.length) toast('只支持 PDF 文件', 'error');
});

// ─────────────────────────── 缩放 / 页码

$('zoomIn').addEventListener('click', () => view.zoomStep(1));
$('zoomOut').addEventListener('click', () => view.zoomStep(-1));
$('zoomReset').addEventListener('click', () => view.setScale(1));

// Ctrl + 滚轮缩放
reader.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  view.zoomStep(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

$('pageInput').addEventListener('change', () => {
  const n = Number($('pageInput').value);
  if (Number.isFinite(n)) view.goToPage(n);
});
$('pageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') view.goToPage(Number($('pageInput').value));
  e.stopPropagation(); // 别把输入当成快捷键
});

// Ctrl+O
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    $('fileInput').click();
  }
});

// ─────────────────────────── 标注：翻译/笔记 tab

function switchTab(name) {
  panelEl.dataset.view = name;
  document.querySelectorAll('.ptab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('notesPane').hidden = name !== 'notes';
  if (name === 'notes') annots.renderNotes($('notesPane'));
}
document.querySelectorAll('.ptab').forEach((b) =>
  b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ─────────────────────────── 保存（Ctrl+S）

/** 导出副本（无句柄 / 句柄写回失败时的降级） */
function downloadBytes(bytes, baseName) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let annotMod = null;       // pdfannot.js 模块（懒加载，失败缓存）
let annotModBroken = false;

async function getAnnotMod() {
  if (annotMod) return annotMod;
  if (annotModBroken) return null;
  try {
    annotMod = await import('./pdfannot.js');
    return annotMod;
  } catch (err) {
    annotModBroken = true;
    console.warn('[save] 注释组件未就绪：', err);
    return null;
  }
}

async function doSave() {
  if (!state.originalBytes) { toast('请先打开 PDF', 'info'); return; }

  // 1) 本地注释库永远先落盘
  try {
    await annots.saveLocal();
  } catch (err) {
    console.warn(err);
    toast('本地标注库写入失败', 'error');
  }

  // 2) 写回 PDF / 导出副本
  const mod = await getAnnotMod();
  if (!mod) { toast('注释组件未就绪，标注已存入本地库', 'error'); return; }

  try {
    const check = await mod.canAnnotate(state.originalBytes);
    if (!check.ok) { toast(check.reason || '该 PDF 无法写入注释', 'error', 5000); return; }

    // 关键：每次保存都从「打开时的原始字节」重建，注释只替换不累加
    const out = await mod.writeAnnotations(state.originalBytes, annots.getList());
    const outBytes = out instanceof Uint8Array ? out : new Uint8Array(out);

    const h = state.handle;
    if (h && typeof h.createWritable === 'function') {
      try {
        const w = await h.createWritable();
        await w.write(outBytes);
        await w.close();
        annots.markSaved();
        toast('已保存（标注已写回 PDF）', 'success');
        return;
      } catch (err) {
        console.warn('[save] 写回句柄失败，转为导出：', err);
        downloadBytes(outBytes, `${state.fileName.replace(/\.pdf$/i, '')}-标注.pdf`);
        annots.markSaved();
        toast('写回原文件失败，已导出副本', 'error', 5000);
        return;
      }
    }
    // 无句柄（拖拽进来的文件 / Firefox / 旧版浏览器）
    // Chrome/Edge：弹「另存为」，选中原文件即可覆盖（浏览器会再确认一次替换）
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const nh = await window.showSaveFilePicker({
          suggestedName: state.fileName,
          types: [{ description: 'PDF 文档', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const w = await nh.createWritable();
        await w.write(outBytes);
        await w.close();
        state.handle = nh; // 之后 Ctrl+S 就能直接覆盖，不再弹框
        annots.markSaved();
        toast('已保存（覆盖原文件）', 'success');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') {
          toast('已取消保存'); // 文件没动，注释仍在本地库里
          return;
        }
        console.warn('[save] showSaveFilePicker 失败，转为下载：', err);
      }
    }
    downloadBytes(outBytes, `${state.fileName.replace(/\.pdf$/i, '')}-标注.pdf`);
    annots.markSaved();
    toast('当前浏览器不支持直接覆盖，已导出副本', 'info', 4500);
  } catch (err) {
    console.error(err);
    toast(`保存失败：${err.message || err}`, 'error', 5000);
  }
}

$('btnSave').addEventListener('click', doSave);

// 快捷键：Ctrl+S 保存 / Esc 关浮层 / Ctrl+Shift+H 套用上次颜色
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && k === 's') {
    e.preventDefault();
    doSave();
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'h') {
    e.preventDefault();
    annots.applyLastColor();
  } else if (e.key === 'Escape') {
    annots.closeOverlays();
  }
});

// ─────────────────────────── 分割条（记忆宽度）

const splitter = $('splitter');

function applyPanelWidth(w) {
  w = Math.min(560, Math.max(380, Math.round(w)));
  document.documentElement.style.setProperty('--panel-w', w + 'px');
  return w;
}

const savedW = Number(localStorage.getItem('zh.panelW'));
if (savedW) applyPanelWidth(savedW);

splitter.addEventListener('mousedown', (e) => {
  e.preventDefault();
  splitter.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const move = (ev) => {
    const w = window.innerWidth - ev.clientX;
    applyPanelWidth(w);
  };
  const up = (ev) => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    splitter.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = applyPanelWidth(window.innerWidth - ev.clientX);
    localStorage.setItem('zh.panelW', String(w));
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});
splitter.addEventListener('dblclick', () => {
  localStorage.setItem('zh.panelW', '440');
  applyPanelWidth(440);
});

// ─────────────────────────── 顶栏：语言 / 服务商 / 自动翻译

async function refreshMeta() {
  try {
    const [meta, settings] = await Promise.all([
      fetch('/api/meta').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]);
    // 容错：配置里残留已下线的服务商（如升级前的旧 id）→ 自动回退到离线示例
    if (settings.active && !meta.providers.some(p => p.id === settings.active)) {
      const staleId = settings.active;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: 'mock' }),
      });
      if (res.ok) Object.assign(settings, await res.json());
      toast(`原服务商「${staleId}」已不可用，已切回离线示例`, 'error', 4500);
    }
    state.meta = meta;
    state.settings = settings;
    panel.providerNames = Object.fromEntries(meta.providers.map(p => [p.id, p.name]));
    renderProviderSelect(meta, settings);
    renderLangSelect(meta, settings);
    updateProvDot(meta, settings);
    panel.sourceLang = settings.source_lang;
    panel.targetLang = settings.target_lang;
    panel.setMockNote(settings.active === 'mock');
  } catch (err) {
    console.error(err);
    toast('无法连接本地服务，请确认已启动', 'error', 5000);
  }
}

function renderProviderSelect(meta, settings) {
  const sel = $('providerSel');
  sel.textContent = '';
  for (const p of meta.providers) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = settings.active;
}

function renderLangSelect(meta, settings) {
  const sel = $('langSel');
  sel.textContent = '';
  for (const l of meta.languages) {
    if (l.code === 'auto') continue; // 目标语言不含「自动检测」
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = l.name;
    sel.appendChild(o);
  }
  sel.value = settings.target_lang;
}

/** 服务商配置状态小圆点 */
function updateProvDot(meta, settings) {
  const dot = $('provDot');
  const id = settings.active;
  if (id === 'mock') { dot.dataset.state = 'mock'; dot.title = '离线示例（无需密钥）'; return; }
  const p = meta.providers.find(x => x.id === id);
  const saved = settings.providers?.[id] || { values: {}, secrets_set: [] };
  const missing = (p?.fields || []).filter((f) => {
    if (!f.required) return false;
    if (f.type === 'password') return !saved.secrets_set?.includes(f.key);
    return !String(saved.values?.[f.key] ?? '').trim();
  });
  if (missing.length) {
    dot.dataset.state = 'none';
    dot.title = `未完成配置：缺少 ${missing.map(f => f.label).join('、')}（点齿轮去设置）`;
  } else {
    dot.dataset.state = 'ok';
    dot.title = `${p?.name || id} 已配置`;
  }
}

$('providerSel').addEventListener('change', async (e) => {
  const id = e.target.value;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: id }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || `HTTP ${res.status}`);
    state.settings = j;
    updateProvDot(state.meta, j);
    panel.setMockNote(j.active === 'mock');
    toast(`已切换到 ${state.meta.providers.find(p => p.id === id)?.name || id}`, 'success');
  } catch (err) {
    e.target.value = state.settings?.active;
    toast(`切换失败：${err.message}`, 'error', 4500);
  }
});

$('langSel').addEventListener('change', async (e) => {
  const code = e.target.value;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_lang: code }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || `HTTP ${res.status}`);
    state.settings = j;
    panel.targetLang = j.target_lang;
  } catch (err) {
    toast(`设置语言失败：${err.message}`, 'error');
  }
});

// 自动翻译开关
const autoBtn = $('autoToggle');
function renderAuto() {
  autoBtn.setAttribute('aria-checked', String(state.auto));
}
autoBtn.addEventListener('click', () => {
  state.auto = !state.auto;
  localStorage.setItem('zh.auto', state.auto ? '1' : '0');
  renderAuto();
});
renderAuto();

// ─────────────────────────── 设置弹窗

const settingsModal = new SettingsModal({
  onSaved(j) {
    state.settings = j;
    renderProviderSelect(state.meta, j);
    updateProvDot(state.meta, j);
    panel.sourceLang = j.source_lang;
    panel.targetLang = j.target_lang;
    panel.setMockNote(j.active === 'mock');
    $('langSel').value = j.target_lang;
  },
});

$('mockGoSettings').addEventListener('click', (e) => {
  e.preventDefault();
  settingsModal.open();
});

// ─────────────────────────── 译文面板：翻译本页

panel.emitPageTranslate = async () => {
  const n = view.current;
  if (!view.doc) { toast('请先打开 PDF', 'info'); return; }
  try {
    const text = await view.getPageText(n);
    panel.onPageText(n, Promise.resolve(text));
  } catch (err) {
    toast(`读取第 ${n} 页失败：${err.message}`, 'error');
  }
};

// ─────────────────────────── 启动

refreshMeta();

// 自测钩子：给 Playwright 断言视图缩放/标注列表/保存路径用（不参与业务逻辑）
window.__zh = { view, annots, state };
