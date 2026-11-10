/**
 * PDF 阅读视图：加载 / 虚拟化渲染 / 缩放 / 划词捕获。
 *
 * 关键点：
 *  - 每页 = canvas + PDF.js TextLayer 叠加，页面容器上必须设置 --scale-factor。
 *  - IntersectionObserver 只渲染可视区附近页面，远处销毁释放内存，占位高度始终保留。
 *  - mouseup 时读取选区文本与页码，回调给翻译面板。
 */
import * as pdfjsLib from '/static/vendor/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.mjs';

const RENDER_MARGIN = '1000px 0px';   // 进入该范围开始渲染
const DESTROY_MARGIN = '3000px 0px';  // 超出该范围销毁（保留占位）

export class PdfView {
  /**
   * @param {HTMLElement} scroller 滚动容器
   * @param {HTMLElement} pagesEl  页容器
   * @param {{onSelect?:Function, onScale?:Function, onPage?:Function}} hooks
   */
  constructor(scroller, pagesEl, hooks = {}) {
    this.scroller = scroller;
    this.pagesEl = pagesEl;
    this.hooks = hooks;
    this.doc = null;
    this.scale = Number(localStorage.getItem('zh.scale')) || 1;
    if (this.scale < 0.25 || this.scale > 4) this.scale = 1;

    this.pageEls = [];      // 每页的 .page 元素（始终存在）
    this.base = [];         // 每页 1x 尺寸 {w,h}
    this.rendered = new Set();
    this._dead = new Set();       // 已销毁、等待重回视口的页
    this.pageTexts = new Map(); // 页码 -> 已抽取的纯文本（翻译本页用）
    this.current = 1;
    this._pageTask = new Map(); // 页码 -> 渲染中的 Promise，防止并发重复渲染

    this._io = new IntersectionObserver((entries) => this._onIntersect(entries), {
      root: this.scroller,
      rootMargin: RENDER_MARGIN,
      threshold: 0,
    });
    this._ioDestroy = new IntersectionObserver((entries) => this._onFar(entries), {
      root: this.scroller,
      rootMargin: DESTROY_MARGIN,
      threshold: 0,
    });

    this._onScroll = () => this._trackCurrentPage();
    this.scroller.addEventListener('scroll', this._onScroll, { passive: true });

    this._bindSelection();
  }

  // ─────────────────────────── 加载

  /** @param {ArrayBuffer} buffer */
  async load(buffer) {
    this.destroy();

    const doc = await pdfjsLib.getDocument({
      data: buffer,
      cMapUrl: '/static/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/static/vendor/pdfjs/standard_fonts/',
    }).promise;
    this.doc = doc;

    // 预取所有页的 1x 尺寸，保证占位高度准确（长论文分片取，避免卡顿）
    const base = [];
    const CONCURRENCY = 8;
    for (let i = 1; i <= doc.numPages; i += CONCURRENCY) {
      const chunk = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, doc.numPages + 1); j++) {
        chunk.push(
          doc.getPage(j).then((p) => {
            const vp = p.getViewport({ scale: 1 });
            base[j - 1] = { w: vp.width, h: vp.height };
          })
        );
      }
      await Promise.all(chunk);
    }
    this.base = base;

    // 建占位
    this.pagesEl.textContent = '';
    this.pageEls = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'page ph';
      el.dataset.page = String(n);
      el.dataset.no = `第 ${n} 页`;
      el.style.setProperty('--scale-factor', String(this.scale));
      el.style.width = Math.floor(base[n - 1].w * this.scale) + 'px';
      el.style.height = Math.floor(base[n - 1].h * this.scale) + 'px';
      const tag = document.createElement('span');
      tag.className = 'page-no';
      tag.textContent = n;
      el.appendChild(tag);
      this.pagesEl.appendChild(el);
      this.pageEls.push(el);
      this._io.observe(el);
      this._ioDestroy.observe(el);
    }

    this.current = 1;
    this.hooks.onPage?.(1, doc.numPages);
    this.hooks.onScale?.(this.scale);
    // 初始渲染首屏
    requestAnimationFrame(() => this._trackCurrentPage());
    return doc;
  }

  destroy() {
    if (!this.doc) return;
    for (const t of this._pageTask.values()) t.catch(() => {});
    this._pageTask.clear();
    this._io.disconnect();
    this._ioDestroy.disconnect();
    this.doc.destroy().catch(() => {});
    this.doc = null;
    this.rendered.clear();
    this._dead.clear();
    this.pageTexts.clear();
    this.pagesEl.textContent = '';
    this.pageEls = [];
    this.base = [];
  }

  // ─────────────────────────── 虚拟化

  _onIntersect(entries) {
    for (const e of entries) {
      if (e.isIntersecting) {
        const n = Number(e.target.dataset.page);
        if (this.doc && !this.rendered.has(n)) this._renderPage(n).catch(() => {});
      }
    }
  }

  _onFar(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) {
        const n = Number(e.target.dataset.page);
        if (this.rendered.has(n)) this._destroyPage(n);
      }
    }
  }

  /** 销毁远处页的 canvas/textLayer，保留占位尺寸。
   *  注意：不能从 _io（渲染观察器）上 unobserve，否则滚回视口时不会再触发渲染。 */
  _destroyPage(n) {
    const el = this.pageEls[n - 1];
    if (!el) return;
    this._dead.add(n);
    const tag = el.querySelector('.page-no');
    el.textContent = '';
    if (tag) el.appendChild(tag);
    el.classList.add('ph');
    this.rendered.delete(n);
  }

  async _renderPage(n) {
    if (!this.doc || this.rendered.has(n)) return;
    const pending = this._pageTask.get(n);
    if (pending) return pending;

    const task = (async () => {
      this._dead.delete(n);
      const el = this.pageEls[n - 1];
      if (!el) return;
      const page = await this.doc.getPage(n);
      const viewport = page.getViewport({ scale: this.scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // 清掉旧内容（占位 or 旧渲染）
      const tag = el.querySelector('.page-no');
      el.textContent = '';
      if (tag) el.appendChild(tag);

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      const ctx = canvas.getContext('2d', { alpha: false });

      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      textDiv.style.width = viewport.width + 'px';
      textDiv.style.height = viewport.height + 'px';

      // --scale-factor 必须在页面容器上，否则选区高亮错位
      el.style.setProperty('--scale-factor', String(viewport.scale));
      el.style.width = Math.floor(viewport.width) + 'px';
      el.style.height = Math.floor(viewport.height) + 'px';
      el.classList.remove('ph');
      el.appendChild(canvas);
      el.appendChild(textDiv);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      });

      // 文本层与渲染并行，加快可选中时间
      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textDiv,
        viewport,
      });
      const layerPromise = textLayer.render().catch(() => {});

      // 抽纯文本供「翻译本页」
      let txt = '';
      for (const it of textContent.items) {
        if (it.str === undefined) continue;
        txt += it.str;
        if (it.hasEOL) txt += '\n';
      }
      this.pageTexts.set(n, txt);

      // 无文本层（扫描件）提示，否则用户不知道为什么选不中
      if (!txt.trim()) {
        const hint = document.createElement('div');
        hint.className = 'no-text-hint';
        hint.textContent = '此页没有文本层，可能是扫描件 · 无法划词';
        el.appendChild(hint);
      }

      await renderTask.promise;
      await layerPromise;
      // 渲染期间被滚出远处销毁：丢弃产物，保持占位
      if (this._dead.has(n)) {
        const t2 = el.querySelector('.page-no');
        el.textContent = '';
        if (t2) el.appendChild(t2);
        el.classList.add('ph');
        return;
      }
      this.rendered.add(n);
      // 通知外部（标注层）在此页重建覆盖层
      this.hooks.onPageRender?.(n);
    })();

    this._pageTask.set(n, task);
    try {
      await task;
    } finally {
      this._pageTask.delete(n);
    }
  }

  // ─────────────────────────── 缩放

  async setScale(next) {
    next = Math.min(4, Math.max(0.25, Math.round(next * 100) / 100));
    if (!this.doc || next === this.scale) return;
    const prev = this.scale;
    this.scale = next;
    localStorage.setItem('zh.scale', String(next));

    // 记住当前页内相对位置，缩放后恢复
    const anchorRatio = this._pageAnchorRatio();

    for (let n = 1; n <= this.base.length; n++) {
      const el = this.pageEls[n - 1];
      if (!el) continue;
      el.style.setProperty('--scale-factor', String(next));
      el.style.width = Math.floor(this.base[n - 1].w * next) + 'px';
      el.style.height = Math.floor(this.base[n - 1].h * next) + 'px';
    }

    // 可见页重渲染
    const jobs = [];
    for (const n of [...this.rendered]) {
      this.rendered.delete(n);
      jobs.push(this._renderPage(n).catch(() => {}));
    }
    await Promise.all(jobs);
    this._restoreAnchor(anchorRatio);
    this.hooks.onScale?.(next);
  }

  zoomStep(dir) {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
    if (dir > 0) {
      const n = steps.find((s) => s > this.scale + 1e-6);
      return this.setScale(n ?? 4);
    }
    const rev = [...steps].reverse();
    const n = rev.find((s) => s < this.scale - 1e-6);
    return this.setScale(n ?? 0.25);
  }

  _pageAnchorRatio() {
    // 当前页顶边相对视口的位置比例，用于缩放后恢复
    const el = this.pageEls[this.current - 1];
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const sr = this.scroller.getBoundingClientRect();
    const inner = r.height > 0 ? (sr.top - r.top) / r.height : 0;
    return Math.min(1, Math.max(0, inner));
  }

  _restoreAnchor(ratio) {
    const el = this.pageEls[this.current - 1];
    if (!el) return;
    const sr = this.scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const delta = r.height * ratio - (sr.top - r.top);
    this.scroller.scrollTop += delta;
  }

  // ─────────────────────────── 当前页 / 跳页

  _trackCurrentPage() {
    if (!this.pageEls.length) return;
    const sr = this.scroller.getBoundingClientRect();
    const mid = sr.top + sr.height * 0.35;
    let best = this.current;
    let bestDist = Infinity;
    for (let i = 0; i < this.pageEls.length; i++) {
      const r = this.pageEls[i].getBoundingClientRect();
      if (r.bottom > sr.top && r.top < sr.bottom) {
        const dist = Math.abs(r.top - mid);
        if (dist < bestDist) { bestDist = dist; best = i + 1; }
      }
    }
    if (best !== this.current) {
      this.current = best;
      this.hooks.onPage?.(best, this.pageEls.length);
    }
  }

  goToPage(n) {
    if (!this.doc) return;
    n = Math.min(this.doc.numPages, Math.max(1, n));
    const el = this.pageEls[n - 1];
    if (!el) return;
    const sr = this.scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.scroller.scrollTop += r.top - sr.top - 8;
    this.current = n;
    this.hooks.onPage?.(n, this.doc.numPages);
    // 确保渲染
    this._renderPage(n).catch(() => {});
  }

  // ─────────────────────────── 划词

  _bindSelection() {
    this.scroller.addEventListener('mouseup', () => {
      // 让浏览器先落定选区
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          this.hooks.onSelectEmpty?.();
          return;
        }
        const text = sel.toString();
        if (!text || !text.trim()) {
          this.hooks.onSelectEmpty?.();
          return;
        }

        // 从锚点找所在页
        let node = sel.anchorNode;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        const pageEl = node?.closest?.('.page');
        const pageNo = pageEl ? Number(pageEl.dataset.page) : this.current;

        // 选区矩形（页面相对 CSS px，含当前缩放）→ 交给标注层换算成 PDF point
        let rects = [];
        let scale = this.scale;
        if (pageEl) {
          const pr = pageEl.getBoundingClientRect();
          scale = parseFloat(pageEl.style.getPropertyValue('--scale-factor')) || this.scale;
          const rr = sel.getRangeAt(0).getClientRects();
          for (const r of rr) {
            if (r.width < 1 || r.height < 1) continue;
            rects.push([r.left - pr.left, r.top - pr.top, r.right - pr.left, r.bottom - pr.top]);
          }
        }

        this.hooks.onSelect?.({ text, page: pageNo, pageEl, rects, scale });
      });
    });
  }

  /** 当前页纯文本（未渲染则现取）。 */
  async getPageText(n) {
    if (this.pageTexts.has(n)) return this.pageTexts.get(n);
    if (!this.doc) return '';
    const page = await this.doc.getPage(n);
    const tc = await page.getTextContent();
    let txt = '';
    for (const it of tc.items) {
      if (it.str === undefined) continue;
      txt += it.str;
      if (it.hasEOL) txt += '\n';
    }
    this.pageTexts.set(n, txt);
    return txt;
  }

  get numPages() { return this.doc?.numPages ?? 0; }
}
