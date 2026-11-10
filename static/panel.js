/**
 * 译文面板：划词状态机 + SSE 流式翻译。
 *  - 连续划词用 AbortController 取消上一请求；
 *  - 手工解析 fetch ReadableStream 的 SSE（EventSource 不支持 POST）；
 *  - 原文可折叠，译文逐字追加，出错保留可重试。
 */
import { ICONS } from './icons.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);

export class TranslatePanel {
  constructor() {
    this.el = {
      srcBlock: $('srcBlock'), srcToggle: $('srcToggle'), srcBody: $('srcBody'),
      srcPage: $('srcPage'), srcMeta: $('srcMeta'),
      status: $('panelStatus'), main: $('panelMain'),
      phIdle: $('phIdle'), phLoading: $('phLoading'),
      errBox: $('errBox'), errMsg: $('errMsg'), errDetail: $('errDetail'),
      mockNote: $('mockNote'), result: $('result'), resultText: $('resultText'),
      caret: $('caret'), footMeta: $('footMeta'),
      btnCopy: $('btnCopy'), btnRetrans: $('btnRetrans'),
      btnClear: $('btnClear'), btnPage: $('btnPage'), btnRetry: $('btnRetry'),
    };

    this.abort = null;
    this.srcText = '';
    this.srcPageNo = null;
    this.outText = '';
    this.meta = null;          // {provider, model, cached, ms}
    this.providerNames = {};   // id -> 显示名
    this.state = 'idle';       // idle | loading | streaming | done | error
    this.lastPayload = null;   // 上一次翻译请求（重试用）
    this.userScrolled = false; // 用户手动滚动过则不再自动回顶
    this._autoScrollEl = $('panelMain');
    this._autoScrollEl.addEventListener('scroll', () => {
      // 只要用户主动把滚动条拽离顶部/底部就算手动（忽略程序滚动）
      if (this._programmaticScroll) return;
      this.userScrolled = true;
    }, { passive: true });

    this.el.srcToggle.addEventListener('click', () => this._toggleSrc());
    this.el.btnCopy.addEventListener('click', () => this.copy());
    this.el.btnRetrans.addEventListener('click', () => this.retranslate());
    this.el.btnClear.addEventListener('click', () => this.clear());
    this.el.btnRetry.addEventListener('click', () => this.retranslate());
    this.el.btnPage.addEventListener('click', () => this.emitPageTranslate?.());
  }

  /** 是否需要在新译文出现时滚回顶部 */
  _maybeScrollTop() {
    if (this.userScrolled) return;
    this._programmaticScroll = true;
    this._autoScrollEl.scrollTop = 0;
    requestAnimationFrame(() => { this._programmaticScroll = false; });
  }

  _toggleSrc(force) {
    const open = force ?? this.el.srcBody.hidden;
    this.el.srcBody.hidden = !open;
    this.el.srcToggle.setAttribute('aria-expanded', String(open));
  }

  // ─────────────────────────── 状态展示

  _show(what) {
    const { phIdle, phLoading, errBox, result } = this.el;
    phIdle.hidden = what !== 'idle';
    phLoading.hidden = what !== 'loading';
    errBox.hidden = what !== 'error';
    result.hidden = !(what === 'result');
  }

  _setStatus(html) {
    if (!html) { this.el.status.hidden = true; this.el.status.innerHTML = ''; return; }
    this.el.status.hidden = false;
    this.el.status.innerHTML = html;
  }

  _setFootMeta(txt) { this.el.footMeta.textContent = txt || ''; }

  // ─────────────────────────── 对外事件（由 app 注入）

  /** 划词：设置原文并（若开启自动）立即翻译 */
  onSelect({ text, page, auto }) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    // 同一段重复选中且已有结果 → 不重复请求
    if (t === this.srcText && this.state === 'done') return;

    this.srcText = t;
    this.srcPageNo = page;
    this.userScrolled = false;
    this.outText = '';
    this.meta = null;
    this.lastPayload = { text: t, page };
    this.el.resultText.textContent = '';
    this.el.caret.hidden = true;
    this.el.srcBody.textContent = t;
    this.el.srcPage.textContent = page ? `p.${page}` : '';
    this.el.srcMeta.textContent = `${t.length} 字符`;
    this._toggleSrc(false);
    this._setStatus('');
    this._setFootMeta('');
    this.el.btnCopy.disabled = true;
    this.el.btnRetrans.disabled = true;
    this.el.btnClear.disabled = true;

    if (auto) this._start(t, false);
    else {
      this.state = 'idle';
      this._show('result');
      this.el.resultText.textContent = '（已选中，点击「重新翻译」或开启自动翻译）';
      this.el.btnRetrans.disabled = false;
      this.el.btnClear.disabled = false;
    }
  }

  /** 翻译整页：外部传入整页文本 */
  async onPageText(pageNo, textPromise) {
    const text = (await textPromise).trim();
    if (!text) { toast('这一页没有可翻译的文本', 'info'); return; }
    this.srcText = text.replace(/\s+/g, ' ').trim().slice(0, 20000);
    this.srcPageNo = pageNo;
    this.userScrolled = false;
    this.outText = '';
    this.lastPayload = { text: this.srcText, page: pageNo, wholePage: true };
    this.el.resultText.textContent = '';
    this.el.caret.hidden = true;
    this.el.srcBody.textContent = text;
    this.el.srcPage.textContent = `p.${pageNo} · 整页`;
    this.el.srcMeta.textContent = `${text.length} 字符`;
    this._toggleSrc(true);
    this.el.btnClear.disabled = false;
    this._start(this.srcText, false);
  }

  // ─────────────────────────── 翻译请求

  retranslate() {
    if (!this.lastPayload) return;
    this._start(this.lastPayload.text, true);
  }

  _start(text, noCache) {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;

    this.state = 'loading';
    this._show('loading');
    this._setStatus(
      `<span class="status-chip streaming"><span class="ic">${ICONS.spinner}</span>翻译中…</span>`
    );
    this._setFootMeta('');
    this.el.errBox.hidden = true;

    const payload = {
      text,
      no_cache: !!noCache,
      source_lang: this.sourceLang || undefined,
      target_lang: this.targetLang || undefined,
    };

    this._stream(payload, ac.signal)
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        this._fail(err?.message || String(err));
      })
      .finally(() => {
        if (this.abort === ac) this.abort = null;
      });
  }

  async _stream(payload, signal) {
    const res = await fetch('/api/translate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j.detail || JSON.stringify(j);
      } catch { detail = `HTTP ${res.status}`; }
      throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let started = false;

    const handle = (obj) => {
      switch (obj.type) {
        case 'start':
          started = true;
          this.state = 'streaming';
          this._show('result');
          this._maybeScrollTop();
          this.el.caret.hidden = false;
          this.meta = { provider: obj.provider, model: obj.model, cached: !!obj.cached, ms: null };
          this._renderStatus('streaming');
          break;
        case 'delta':
          if (!started) { started = true; this._show('result'); }
          if (this.state !== 'streaming') this.state = 'streaming';
          this.outText += obj.text;
          // 逐字追加：用 textNode 追加比 innerHTML 安全且快
          this.el.resultText.append(document.createTextNode(obj.text));
          break;
        case 'done':
          this.meta = {
            provider: obj.provider, model: obj.model,
            cached: !!obj.cached, ms: obj.ms,
          };
          this.state = 'done';
          this.el.caret.hidden = true;
          this._renderStatus('done');
          this.el.btnCopy.disabled = !this.outText;
          this.el.btnRetrans.disabled = false;
          this.el.btnClear.disabled = false;
          break;
        case 'error':
          this._fail(obj.message || '未知错误');
          break;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      // SSE 帧以空行分隔：每行 `data: {json}\n\n`
      while ((idx = buf.search(/\n\n|\r\n\r\n/)) !== -1) {
        const m = buf.match(/\r?\n\r?\n/);
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + m[0].length);
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try { handle(JSON.parse(json)); } catch { /* 跳过坏帧 */ }
        }
      }
    }

    if (this.state === 'streaming' || this.state === 'loading') {
      // 流正常结束但没收到 done —— 视为完成
      if (this.outText) {
        this.state = 'done';
        this.el.caret.hidden = true;
        this._renderStatus('done');
        this.el.btnCopy.disabled = false;
        this.el.btnRetrans.disabled = false;
        this.el.btnClear.disabled = false;
      } else if (this.state === 'loading') {
        this._fail('服务没有返回内容');
      }
    }
  }

  _renderStatus(phase) {
    const m = this.meta || {};
    const provName = (this.providerNames && this.providerNames[m.provider]) || m.provider;
    const prov = m.provider ? `<span class="status-chip">服务 <b>${esc(provName)}</b></span>` : '';
    const model = m.model ? `<span class="status-chip">模型 <b>${esc(m.model)}</b></span>` : '';
    const ms = m.ms != null ? `<span class="status-chip">${(m.ms / 1000).toFixed(2)}s</span>` : '';
    const cache = m.cached
      ? `<span class="status-chip cache-hit">缓存命中</span>`
      : (m.ms != null ? `<span class="status-chip">未命中缓存</span>` : '');
    const stream = phase === 'streaming'
      ? `<span class="status-chip streaming"><span class="ic">${ICONS.spinner}</span>生成中</span>` : '';
    this._setStatus(prov + model + stream + ms + cache);

    const bits = [];
    if (this.srcPageNo) bits.push(`第 ${this.srcPageNo} 页`);
    if (phase === 'done') {
      bits.push(this.outText.length + ' 字');
      if (m.cached) bits.push('来自缓存');
    }
    this._setFootMeta(bits.join(' · '));
  }

  _fail(message) {
    // fetch 断流时浏览器给的是英文 "network error"，换成可读文案
    if (message === 'network error' || message === 'Failed to fetch') {
      message = '与本地服务的连接中断（服务可能返回了错误），请重试';
    }
    this.state = 'error';
    this._show('error');
    this.el.caret.hidden = true;
    this.el.errMsg.textContent = message || '翻译失败';
    this.el.errDetail.hidden = true;
    this._setStatus(`<span class="status-chip" style="color:var(--c-err);border-color:#e8c4c0">翻译失败</span>`);
    this._setFootMeta('可点「重试」再次发送');
    this.el.btnRetrans.disabled = false;
    this.el.btnClear.disabled = false;
    this.el.btnCopy.disabled = !this.outText;
  }

  // ─────────────────────────── 操作

  async copy() {
    if (!this.outText) return;
    try {
      await navigator.clipboard.writeText(this.outText);
      toast('译文已复制', 'success');
    } catch {
      // 剪贴板不可用时退化
      const ta = document.createElement('textarea');
      ta.value = this.outText;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('译文已复制', 'success'); }
      catch { toast('复制失败，请手动选择', 'error'); }
      ta.remove();
    }
  }

  clear() {
    this.abort?.abort();
    this.abort = null;
    this.state = 'idle';
    this.srcText = '';
    this.srcPageNo = null;
    this.outText = '';
    this.meta = null;
    this.lastPayload = null;
    this.userScrolled = false;
    this.el.resultText.textContent = '';
    this.el.srcBody.textContent = '';
    this.el.srcPage.textContent = '';
    this.el.srcMeta.textContent = '';
    this._toggleSrc(false);
    this._setStatus('');
    this._setFootMeta('');
    this.el.btnCopy.disabled = true;
    this.el.btnRetrans.disabled = true;
    this.el.btnClear.disabled = true;
    this._show('idle');
  }

  /** 空闲时提示文案 */
  setIdleHint() { this._show('idle'); }

  setMockNote(show) {
    this.el.mockNote.hidden = !show;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
