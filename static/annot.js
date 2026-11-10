/**
 * 标注层：划词工具条 / 高亮渲染 / 备忘录浮层 / 笔记列表 / IndexedDB 持久化。
 *
 * 坐标约定（与 pdfannot.js 契约一致）：
 *  - 存储 rect = 页面坐标，单位 PDF point（= scale 1 时的 CSS px），原点左上、y 向下；
 *  - 划词得到的是当前缩放下的页面相对 CSS px，入库前 ÷ scale；
 *  - 渲染时读页面容器的 --scale-factor 再 × scale，缩放重绘不漂移。
 */
import { toast } from './toast.js';

/** 高亮色板：CSS 用色 + PDF C 值（0..1） */
export const COLORS = [
  { id: 'yellow', css: '#ffd759', rgb: [1, 0.843, 0.349] },
  { id: 'green',  css: '#7ed98c', rgb: [0.494, 0.851, 0.549] },
  { id: 'blue',   css: '#60a8ff', rgb: [0.376, 0.659, 1] },
  { id: 'pink',   css: '#ff85c0', rgb: [1, 0.522, 0.753] },
];

const OPACITY = 0.4;
const DB_NAME = 'zhihuan-annot';
const STORE = 'docs';

// ─────────────────────────── IndexedDB

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(key);
    rq.onsuccess = () => { resolve(rq.result || null); db.close(); };
    rq.onerror = () => { reject(rq.error); db.close(); };
  });
}

async function idbPut(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
    tx.onabort = () => { reject(tx.error); db.close(); };
  });
}

// ─────────────────────────── 工具

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

const rgba = (c, a) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ─────────────────────────── 标注管理器

export class AnnotManager {
  /**
   * @param {import('./pdfview.js').PdfView} view
   * @param {{onChange?:(list)=>void, onDirty?:()=>void}} hooks
   */
  constructor(view, hooks = {}) {
    this.view = view;
    this.hooks = hooks;
    this.annots = [];
    this.key = null;
    this.dirty = false;
    this.pending = null;      // 当前划词 {page, pageEl, text, pts, viewport}
    this.lastColor = null;    // 上次用的颜色 rgb[]
    this._saveTimer = null;
    this._hoverHl = null;
    this._tipTimer = null;
    this._flashId = null;
    this._flashTimer = null;

    this._buildToolbar();
    this._buildPopover();
    this._buildTooltip();
    this._bind();
  }

  // ─────────────────────── DOM：选区工具条

  _buildToolbar() {
    const el = document.createElement('div');
    el.className = 'sel-toolbar';
    el.hidden = true;
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', '高亮工具条');
    let html = '';
    for (const c of COLORS) {
      html += `<button class="st-dot" data-color="${c.id}" style="--dot:${c.css}" title="${c.id === 'yellow' ? '黄色' : c.id === 'green' ? '绿色' : c.id === 'blue' ? '蓝色' : '粉色'}高亮"></button>`;
    }
    html += '<span class="st-sep"></span><button class="st-note" title="高亮并写笔记">笔记</button>';
    el.innerHTML = html;
    document.body.appendChild(el);
    this.toolbar = el;

    el.addEventListener('mousedown', (e) => e.preventDefault()); // 别抢走选区
    el.addEventListener('click', (e) => {
      const dot = e.target.closest('.st-dot');
      if (dot) {
        const c = COLORS.find((x) => x.id === dot.dataset.color);
        if (c) this.createAnnot(c.rgb, false);
        return;
      }
      if (e.target.closest('.st-note')) this.createAnnot(this.lastColor || COLORS[0].rgb, true);
    });
  }

  // ─────────────────────── DOM：备忘录浮层

  _buildPopover() {
    const el = document.createElement('div');
    el.className = 'hl-pop';
    el.hidden = true;
    let sw = '';
    for (const c of COLORS) {
      sw += `<button class="hp-dot" data-color="${c.id}" style="--dot:${c.css}" title="${c.id}"></button>`;
    }
    el.innerHTML =
      `<textarea class="hp-input" rows="3" placeholder="写点笔记…（Ctrl+Enter 保存，Esc 取消）"></textarea>` +
      `<div class="hp-row"><span class="hp-swatches">${sw}</span>` +
      `<span class="hp-spacer"></span>` +
      `<button class="btn small ghost danger" data-act="del">删除</button>` +
      `<button class="btn small" data-act="cancel">取消</button>` +
      `<button class="btn small primary" data-act="save">保存</button></div>`;
    document.body.appendChild(el);
    this.popover = el;

    this._popInput = el.querySelector('.hp-input');
    this._popInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 别触发全局快捷键的误判
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this._popSave(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeOverlays(); }
    });

    el.addEventListener('click', (e) => {
      const dot = e.target.closest('.hp-dot');
      if (dot && this._popId) {
        const c = COLORS.find((x) => x.id === dot.dataset.color);
        const a = this.byId(this._popId);
        if (c && a) {
          a.color = [...c.rgb];
          this.lastColor = [...c.rgb];
          this._touch();
          this.renderPage(a.page);
          this._syncPopoverSwatches();
        }
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'save') this._popSave();
      else if (act === 'cancel') this.closeOverlays();
      else if (act === 'del') this._popDelete();
    });
  }

  _buildTooltip() {
    const el = document.createElement('div');
    el.className = 'hl-tip';
    el.hidden = true;
    document.body.appendChild(el);
    this.tip = el;
  }

  _bind() {
    // 点在工具条/浮层之外 → 收起
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest?.('.sel-toolbar')) return;
      this.hideToolbar();
      if (!e.target.closest?.('.hl-pop') && !e.target.closest?.('.hl')) this.closePopover();
    });

    // 点高亮块 → 弹备忘录浮层
    this.view.scroller.addEventListener('click', (e) => {
      const hl = e.target.closest?.('.hl');
      if (!hl) return;
      const a = this.byId(hl.dataset.id);
      if (a) this.openPopover(a.id, hl);
    });

    // 悬停：便签角标 + 300ms 笔记预览
    this.view.scroller.addEventListener('mouseover', (e) => {
      const hl = e.target.closest?.('.hl');
      if (hl === this._hoverHl) return;
      this._clearHover();
      if (!hl) return;
      const a = this.byId(hl.dataset.id);
      if (!a || !a.note) return;
      this._hoverHl = hl;
      this._setBadge(a.id, true);
      this._tipTimer = setTimeout(() => this._showTip(a, hl), 300);
    });
    this.view.scroller.addEventListener('mouseout', (e) => {
      const from = e.target.closest?.('.hl');
      const to = e.relatedTarget?.closest?.('.hl');
      if (from && to === from) return;
      if (from) this._clearHover();
    });

    // 滚动让工具条位置失效 → 收起
    this.view.scroller.addEventListener('scroll', () => this.hideToolbar(), { passive: true });
  }

  // ─────────────────────── 文档生命周期

  /** 打开新文档：按 key 从 IndexedDB 恢复标注并渲染 */
  async setDoc({ fileName, size, lastModified }) {
    this.closeOverlays();
    this.hideToolbar();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.key = `${fileName}|${size}|${lastModified}`;
    this.annots = [];
    this.pending = null;
    this.dirty = false;
    try {
      const rec = await idbGet(this.key);
      if (rec && Array.isArray(rec.annots)) this.annots = rec.annots;
    } catch (err) {
      console.warn('[annot] 读取本地标注失败：', err);
    }
    this.renderAll();
    this.hooks.onChange?.(this.getList());
  }

  clear() {
    this.closeOverlays();
    this.hideToolbar();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.annots = [];
    this.key = null;
    this.pending = null;
    this.dirty = false;
    this.hooks.onChange?.([]);
  }

  /** 立即写 IndexedDB（Ctrl+S 时先调用） */
  async saveLocal() {
    if (!this.key) return;
    await idbPut(this.key, { annots: this.annots, updatedAt: Date.now() });
  }

  markSaved() {
    this.dirty = false;
    this.hooks.onSaved?.();
  }

  // ─────────────────────── 划词 → 工具条

  /** pdfview.onSelect：记录待标注选区并弹出工具条 */
  onSelection(sel) {
    const { page, pageEl, rects, scale, text } = sel;
    if (!pageEl || !rects || !rects.length) { this.hideToolbar(); this.pending = null; return; }
    const pts = rects.map((r) => r.map((v) => v / scale)); // CSS px → PDF point
    this.pending = { page, pageEl, text, pts };

    // 工具条定位（视口坐标）：贴选区末尾下方，放不下翻到上方，水平夹在阅读区内
    const pr = pageEl.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, pr.left + r[0]); y0 = Math.min(y0, pr.top + r[1]);
      x1 = Math.max(x1, pr.left + r[2]); y1 = Math.max(y1, pr.top + r[3]);
    }
    const sr = this.view.scroller.getBoundingClientRect();
    this.toolbar.hidden = false;
    const tw = this.toolbar.offsetWidth, th = this.toolbar.offsetHeight;
    let left = Math.min(Math.max(x0, sr.left + 8), sr.right - tw - 8);
    let top = y1 + 6;
    if (top + th > sr.bottom - 6) top = y0 - th - 6;
    top = Math.min(Math.max(top, sr.top + 6), sr.bottom - th - 6);
    this.toolbar.style.left = Math.round(left) + 'px';
    this.toolbar.style.top = Math.round(top) + 'px';
  }

  /** 选区消失（点空白/点高亮） */
  onSelectEmpty() { this.hideToolbar(); this.pending = null; }

  hideToolbar() { if (this.toolbar) this.toolbar.hidden = true; }

  onScaleChange() { this.hideToolbar(); this._clearHover(); this.closePopover(); }

  /** Ctrl+Shift+H：对当前选区套用上次颜色 */
  applyLastColor() {
    if (!this.pending) { toast('先选中要高亮的文字', 'info'); return; }
    if (!this.lastColor) { toast('还没有用过高亮颜色', 'info'); return; }
    this.createAnnot(this.lastColor, false);
  }

  // ─────────────────────── 标注增删改

  /** 按当前选区创建一条标注；withNote=true 时接着弹输入框 */
  createAnnot(colorRgb, withNote) {
    if (!this.pending) { toast('先选中要高亮的文字', 'info'); return null; }
    const p = this.pending;
    const a = {
      id: uid(),
      page: p.page,
      color: [...colorRgb],
      opacity: OPACITY,
      note: '',
      text: p.text.replace(/\s+/g, ' ').trim(),
      rects: p.pts.map((r) => [...r]),
    };
    this.annots.push(a);
    this.lastColor = [...colorRgb];
    this.hideToolbar();
    this.pending = null;
    this.renderPage(a.page);
    this._touch();

    if (withNote) {
      // 等高亮块落进 DOM 再锚定浮层
      requestAnimationFrame(() => {
        const block = document.querySelector(`.hl[data-id="${a.id}"]`);
        this.openPopover(a.id, block);
      });
    }
    return a;
  }

  byId(id) { return this.annots.find((a) => a.id === id) || null; }

  // ─────────────────────── 备忘录浮层

  openPopover(id, anchorEl) {
    const a = this.byId(id);
    if (!a) return;
    this._popId = id;
    this._popInput.value = a.note || '';
    this._syncPopoverSwatches();
    this.popover.hidden = false;
    this.hideToolbar();

    const r = (anchorEl || document.querySelector(`.hl[data-id="${id}"]`))
      ?.getBoundingClientRect();
    const pw = this.popover.offsetWidth, ph = this.popover.offsetHeight;
    if (r) {
      let left = Math.min(r.left, window.innerWidth - pw - 10);
      let top = r.bottom + 8;
      if (top + ph > window.innerHeight - 10) top = Math.max(10, r.top - ph - 8);
      this.popover.style.left = Math.max(10, Math.round(left)) + 'px';
      this.popover.style.top = Math.round(top) + 'px';
    } else {
      this.popover.style.left = '40px';
      this.popover.style.top = '80px';
    }
    this._popInput.focus();
    this._popInput.setSelectionRange(this._popInput.value.length, this._popInput.value.length);
  }

  _syncPopoverSwatches() {
    const a = this.byId(this._popId);
    this.popover.querySelectorAll('.hp-dot').forEach((d) => {
      const c = COLORS.find((x) => x.id === d.dataset.color);
      d.classList.toggle('on', !!a && !!c && c.rgb.every((v, i) => Math.abs(v - a.color[i]) < 1e-6));
    });
  }

  _popSave() {
    const a = this.byId(this._popId);
    if (a) {
      const v = this._popInput.value.replace(/\s+$/, '');
      if (v !== (a.note || '')) { a.note = v; this._touch(); this.renderPage(a.page); }
    }
    this.closeOverlays();
  }

  _popDelete() {
    const a = this.byId(this._popId);
    if (a) {
      this.annots = this.annots.filter((x) => x.id !== a.id);
      this._touch();
      this.renderPage(a.page);
      toast('已删除标注', 'success');
    }
    this.closeOverlays();
  }

  closePopover() {
    if (this.popover) { this.popover.hidden = true; this._popId = null; }
  }

  closeOverlays() {
    this.closePopover();
    this.hideToolbar();
    this._clearHover();
  }

  // ─────────────────────── 悬停 tooltip / 角标

  _showTip(a, hlEl) {
    const note = a.note || '';
    if (!note) return;
    this.tip.textContent = note.length > 80 ? note.slice(0, 80) + '…' : note;
    this.tip.hidden = false;
    const r = hlEl.getBoundingClientRect();
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - tw - 10);
    let top = r.bottom + 6;
    if (top + th > window.innerHeight - 8) top = r.top - th - 6;
    this.tip.style.left = Math.max(8, Math.round(left)) + 'px';
    this.tip.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  _clearHover() {
    if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null; }
    if (this.tip) this.tip.hidden = true;
    if (this._hoverHl) {
      const badge = this._badgeOf(this._hoverHl.dataset.id);
      badge?.classList.remove('on');
      this._hoverHl = null;
    }
  }

  _badgeOf(id) { return this.view.pagesEl.querySelector(`.hl-badge[data-id="${CSS.escape(id)}"]`); }

  _setBadge(id, on) { this._badgeOf(id)?.classList.toggle('on', on); }

  // ─────────────────────── 高亮渲染

  renderAll() {
    if (!this.view.pageEls) return;
    for (let n = 1; n <= this.view.pageEls.length; n++) this.renderPage(n);
  }

  /** 重建第 n 页的高亮覆盖层（页未渲染则等 onPageRender 再来） */
  renderPage(n) {
    const el = this.view.pageEls[n - 1];
    if (!el || !el.querySelector('canvas')) return; // 占位页，渲染完成会回调
    let layer = el.querySelector('.hl-layer');
    if (!layer || !el.contains(layer)) {
      layer = document.createElement('div');
      layer.className = 'hl-layer';
      layer.dataset.page = String(n);
      el.appendChild(layer);
    }
    layer.textContent = '';
    const s = parseFloat(el.style.getPropertyValue('--scale-factor')) || this.view.scale || 1;

    for (const a of this.annots) {
      if (a.page !== n) continue;
      for (const r of a.rects) {
        const d = document.createElement('div');
        d.className = 'hl';
        d.dataset.id = a.id;
        d.style.left = (r[0] * s) + 'px';
        d.style.top = (r[1] * s) + 'px';
        d.style.width = Math.max(2, (r[2] - r[0]) * s) + 'px';
        d.style.height = Math.max(2, (r[3] - r[1]) * s) + 'px';
        d.style.background = rgba(a.color, a.opacity ?? OPACITY);
        layer.appendChild(d);
      }
      if (a.note) {
        // 便签角标：与 .hl 同级（.hl 是 multiply 混合组，白色角标放进去会被混掉）
        const r0 = a.rects[0];
        if (!r0) continue;
        const b = document.createElement('i');
        b.className = 'hl-badge';
        b.dataset.id = a.id;
        b.style.left = (r0[2] * s - 7) + 'px';
        b.style.top = (r0[1] * s - 7) + 'px';
        layer.appendChild(b);
      }
    }

    // 跳页闪烁
    if (this._flashId) {
      const flashId = this._flashId;
      requestAnimationFrame(() => this._tryFlash(flashId));
    }
  }

  // ─────────────────────── 跳页 + 闪烁

  flash(id) {
    const a = this.byId(id);
    if (!a) return;
    this._flashId = id;
    this.view.goToPage(a.page);
    this._tryFlash(id);
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { this._flashId = null; }, 2500);
  }

  _tryFlash(id) {
    const blocks = this.view.pagesEl.querySelectorAll(`.hl[data-id="${CSS.escape(id)}"]`);
    if (!blocks.length) return; // 等页面渲染完，renderPage 会再试
    for (const b of blocks) {
      b.classList.remove('flash');
      void b.offsetWidth; // 重启动画
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 1600);
    }
    this._flashId = null;
  }

  // ─────────────────────── 笔记列表

  getList() {
    return [...this.annots].sort((a, b) =>
      a.page - b.page ||
      ((a.rects?.[0]?.[1] ?? 0) - (b.rects?.[0]?.[1] ?? 0)));
  }

  /** 渲染「笔记」tab 列表 */
  renderNotes(container) {
    const list = this.getList();
    container.textContent = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-empty';
      empty.innerHTML =
        '<p class="ne-title">还没有标注</p>' +
        '<p class="ne-sub">在左侧选中文字，点颜色圆点即可高亮；点「笔记」可以顺手记下想法。</p>';
      container.appendChild(empty);
      return;
    }
    for (const a of list) {
      const item = document.createElement('button');
      item.className = 'note-item';
      item.type = 'button';
      item.dataset.id = a.id;
      const c = rgba(a.color, 1);
      const text = a.text.length > 90 ? a.text.slice(0, 90) + '…' : a.text;
      const note = a.note
        ? `<span class="ni-note">${esc(a.note.length > 90 ? a.note.slice(0, 90) + '…' : a.note)}</span>`
        : '<span class="ni-note none">（未写笔记）</span>';
      item.innerHTML =
        `<span class="ni-dot" style="background:${c}"></span>` +
        `<span class="ni-body"><span class="ni-page">第 ${a.page} 页</span>` +
        `<span class="ni-text">${esc(text)}</span>${note}</span>`;
      item.addEventListener('click', () => this.flash(a.id));
      container.appendChild(item);
    }
  }

  // ─────────────────────── 变更通知（立即写库，防刷新/崩溃丢数据）

  _touch() {
    this.dirty = true;
    this.hooks.onChange?.(this.getList());
    this.hooks.onDirty?.();
    // 标注数据很小，直接写；攒防抖反而会在用户立刻刷新时丢
    this.saveLocal().catch((err) => console.warn('[annot] 自动保存失败：', err));
  }
}

export default AnnotManager;
