/**
 * 设置弹窗：按 /api/meta 动态渲染服务商卡片，测试连接 / 保存 / 清缓存。
 */
import { ICONS } from './icons.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);

export class SettingsModal {
  /**
   * @param {{onSaved:Function}} cb onSaved(新settings) —— 刷新顶栏状态
   */
  constructor(cb) {
    this.cb = cb;
    this.meta = null;
    this.settings = null;
    this.dirty = false;
    this.busy = false;

    $('btnSettings').addEventListener('click', () => this.open());
    $('setClose').addEventListener('click', () => this.close());
    $('setCancel').addEventListener('click', () => this.close());
    $('setSave').addEventListener('click', () => this.save());
    $('btnClearCache').addEventListener('click', () => this.clearCache());
    $('setMask').addEventListener('mousedown', (e) => {
      if (e.target === $('setMask')) this.close();
    });

    // 关闭前提示未保存
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('setMask').hidden) this.close();
    });
  }

  async open() {
    $('setMask').hidden = false;
    $('setBody').innerHTML = '<div class="set-loading">正在读取配置…</div>';
    $('setHint').textContent = '';
    $('setHint').classList.remove('err');
    this.dirty = false;

    try {
      const [meta, settings, health] = await Promise.all([
        fetch('/api/meta').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/health').then(r => r.json()).catch(() => null),
      ]);
      this.meta = meta;
      this.settings = settings;
      this._renderBar(meta, settings, health);
      this._renderCards(meta, settings);
      this.dirty = false;
    } catch (err) {
      $('setBody').innerHTML = `<div class="set-loading" style="color:var(--c-err)">读取配置失败：${esc(err.message)}</div>`;
    }
  }

  close() {
    if (this.dirty && !confirm('设置尚未保存，确定要关闭吗？')) return;
    $('setMask').hidden = true;
    this.dirty = false;
  }

  // ─────────────────────────── 顶栏（语言 / 服务商 / 缓存）

  _renderBar(meta, settings, health) {
    fillSelect($('setActive'), meta.providers.map(p => ({ code: p.id, name: p.name })), settings.active);
    const langs = meta.languages.map(l => ({ code: l.code, name: l.name }));
    fillSelect($('setSrc'), langs, settings.source_lang);
    fillSelect($('setTgt'), langs.filter(l => l.code !== 'auto'), settings.target_lang);

    const c = health?.cache;
    $('cacheBox').textContent = c
      ? `缓存 ${c.entries} 条 · ${formatSize(c.size_kb)}`
      : '缓存 –';

    for (const id of ['setActive', 'setSrc', 'setTgt']) {
      $(id).onchange = () => { this.dirty = true; this._syncCardActive(); };
    }
    this._syncCardActive();
  }

  _syncCardActive() {
    const active = $('setActive').value;
    document.querySelectorAll('.prov-card').forEach((card) => {
      card.classList.toggle('active-card', card.dataset.id === active);
      const pick = card.querySelector('.prov-pick input');
      if (pick) pick.checked = card.dataset.id === active;
    });
  }

  // ─────────────────────────── 服务商卡片

  _renderCards(meta, settings) {
    const body = $('setBody');
    body.textContent = '';
    for (const p of meta.providers) {
      body.appendChild(this._card(p, settings.providers?.[p.id] || { values: {}, secrets_set: [] }));
    }
  }

  _card(p, saved) {
    const card = document.createElement('section');
    card.className = 'prov-card';
    card.dataset.id = p.id;

    // 头部
    const head = document.createElement('div');
    head.className = 'prov-card-head';
    head.innerHTML = `
      <span class="prov-name"></span>
      ${p.tag ? '<span class="prov-tag"></span>' : ''}
      ${p.docs ? '<a class="prov-docs" target="_blank" rel="noopener">官方文档 ↗</a>' : ''}
      <label class="prov-pick"><input type="radio" name="activeProv" value=""> 使用此服务</label>`;
    head.querySelector('.prov-name').textContent = p.name;
    if (p.tag) head.querySelector('.prov-tag').textContent = p.tag;
    if (p.docs) {
      const a = head.querySelector('.prov-docs');
      a.href = p.docs;
    }
    const pick = head.querySelector('.prov-pick input');
    pick.checked = this.settings?.active === p.id;
    pick.addEventListener('change', () => {
      if (pick.checked) { $('setActive').value = p.id; this.dirty = true; this._syncCardActive(); }
    });
    card.appendChild(head);

    if (p.desc) {
      const d = document.createElement('p');
      d.className = 'prov-desc';
      d.textContent = p.desc;
      card.appendChild(d);
    }

    // 字段
    const fields = p.fields || [];
    if (fields.length) {
      const grid = document.createElement('div');
      grid.className = 'prov-fields';
      const normal = fields.filter(f => !f.advanced);
      const advanced = fields.filter(f => f.advanced);

      for (const f of normal) grid.appendChild(this._field(p, f, saved));

      if (advanced.length) {
        const wrap = document.createElement('div');
        wrap.className = 'adv-rows';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'adv-toggle';
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = `<span class="ic">${ICONS.chevronRight}</span>高级选项`;
        const advGrid = document.createElement('div');
        advGrid.className = 'adv-fields';
        for (const f of advanced) advGrid.appendChild(this._field(p, f, saved));
        btn.addEventListener('click', () => {
          const open = advGrid.classList.toggle('open');
          btn.setAttribute('aria-expanded', String(open));
        });
        wrap.append(btn, advGrid);
        grid.appendChild(wrap);
      }
      card.appendChild(grid);
    }

    // 底部：测试连接
    const foot = document.createElement('div');
    foot.className = 'prov-foot';
    if (fields.length || p.id === 'mock') {
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.innerHTML = `<span class="ic">${ICONS.zap}</span>测试连接`;
      const result = document.createElement('span');
      result.className = 'test-result';
      btn.addEventListener('click', () => this._test(p, btn, result));
      foot.append(btn, result);
    }
    card.appendChild(foot);

    return card;
  }

  _field(p, f, saved) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.dataset.key = f.key;
    wrap.dataset.provider = p.id;

    const lab = document.createElement('span');
    lab.className = 'f-label';
    lab.textContent = f.label;
    if (f.required) {
      const s = document.createElement('span');
      s.className = 'req';
      s.textContent = '*';
      lab.appendChild(s);
    } else {
      const s = document.createElement('span');
      s.className = 'opt';
      s.textContent = '（可选）';
      lab.appendChild(s);
    }
    wrap.appendChild(lab);

    const current = saved.values?.[f.key] ?? f.default ?? '';
    const secret = f.type === 'password';
    const secretSet = secret && saved.secrets_set?.includes(f.key);

    if (f.type === 'select') {
      const sel = document.createElement('select');
      fillSelect(sel, (f.options || []).map(o => ({ code: o.value, name: o.label })), current);
      sel.addEventListener('change', () => { this.dirty = true; });
      wrap.appendChild(sel);
    } else {
      const iwrap = document.createElement('span');
      iwrap.className = 'f-input-wrap';
      const input = document.createElement('input');
      input.type = f.type === 'password' ? 'password' : 'text';
      input.value = current;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (secret && secretSet) {
        input.value = '';
        input.placeholder = '已保存，留空则不修改';
        const hint = document.createElement('span');
        hint.className = 'f-help f-hint-saved';
        hint.textContent = '✓ 已保存在本地（权限 600），不会上传';
        wrap.appendChild(hint);
      }
      if (f.suggest && f.suggest.length) {
        const dl = document.createElement('datalist');
        dl.id = `dl-${p.id}-${f.key}`;
        for (const s of f.suggest) {
          const o = document.createElement('option');
          o.value = s;
          dl.appendChild(o);
        }
        input.setAttribute('list', dl.id);
        wrap.appendChild(dl);
      }
      input.addEventListener('input', () => { this.dirty = true; });
      iwrap.appendChild(input);

      if (secret) {
        const eye = document.createElement('button');
        eye.type = 'button';
        eye.className = 'f-eye';
        eye.title = '显示/隐藏';
        eye.innerHTML = `<span class="ic">${ICONS.eye}</span>`;
        eye.addEventListener('click', (e) => {
          e.preventDefault();
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          eye.innerHTML = `<span class="ic">${show ? ICONS.eyeOff : ICONS.eye}</span>`;
        });
        iwrap.appendChild(eye);
      }
      wrap.appendChild(iwrap);
    }

    if (f.help) {
      const h = document.createElement('span');
      h.className = 'f-help';
      h.textContent = f.help;
      wrap.appendChild(h);
    }
    return wrap;
  }

  /** 收集某张卡片里所有字段的当前值 */
  _collect(card) {
    const values = {};
    card.querySelectorAll('.field[data-key]').forEach((fw) => {
      const key = fw.dataset.key;
      const input = fw.querySelector('input, select');
      if (input) values[key] = input.value;
    });
    return values;
  }

  // ─────────────────────────── 测试连接

  async _test(p, btn, result) {
    const card = btn.closest('.prov-card');
    const values = this._collect(card);
    btn.disabled = true;
    btn.innerHTML = `<span class="ic">${ICONS.spinner}</span>测试中…`;
    result.className = 'test-result';
    result.textContent = '';

    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(p.id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || `HTTP ${res.status}`);
      if (j.ok) {
        result.className = 'test-result ok';
        const sample = (j.sample || '').replace(/\s+/g, ' ').slice(0, 160);
        result.innerHTML = `<b>✓ 连接成功</b> · ${j.ms}ms${sample ? `<span class="detail">样例：${esc(sample)}</span>` : ''}`;
      } else {
        result.className = 'test-result fail';
        result.innerHTML = `<b>✕ ${esc(j.message || '测试失败')}</b>${j.detail ? `<span class="detail">${esc(j.detail)}</span>` : ''}`;
      }
    } catch (err) {
      result.className = 'test-result fail';
      result.textContent = `✕ ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span class="ic">${ICONS.zap}</span>测试连接`;
    }
  }

  // ─────────────────────────── 保存

  async save() {
    if (this.busy) return;
    const providers = {};
    document.querySelectorAll('.prov-card').forEach((card) => {
      const values = this._collect(card);
      const changed = {};
      let any = false;
      for (const [k, v] of Object.entries(values)) {
        // 只传改过的字段：密码留空 = 不修改，跳过
        const orig = this.settings.providers?.[card.dataset.id]?.values?.[k] ?? '';
        const isSecret = card.querySelector(`.field[data-key="${cssEsc(k)}"] input`)?.type === 'password';
        if (isSecret && v === '') continue;
        if (String(v) !== String(orig ?? '')) { changed[k] = v; any = true; }
      }
      if (any) providers[card.dataset.id] = changed;
    });

    const payload = {
      active: $('setActive').value,
      source_lang: $('setSrc').value,
      target_lang: $('setTgt').value,
      providers,
    };

    const btn = $('setSave');
    this.busy = true;
    btn.disabled = true;
    btn.innerHTML = `<span class="ic">${ICONS.spinner}</span>保存中`;

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || `HTTP ${res.status}`);
      this.settings = j;
      this.dirty = false;
      $('setMask').hidden = true;
      toast('设置已保存', 'success');
      this.cb?.onSaved(j);
    } catch (err) {
      $('setHint').textContent = `保存失败：${err.message}`;
      $('setHint').classList.add('err');
      toast(`保存失败：${err.message}`, 'error', 4500);
    } finally {
      this.busy = false;
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }

  // ─────────────────────────── 缓存

  async clearCache() {
    try {
      const res = await fetch('/api/cache', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const c = j.cache || { entries: 0, size_kb: 0 };
      $('cacheBox').textContent = `缓存 ${c.entries} 条 · ${formatSize(c.size_kb)}`;
      toast('翻译缓存已清空', 'success');
    } catch (err) {
      toast(`清缓存失败：${err.message}`, 'error');
    }
  }
}

// ─────────────────────────── 工具

function fillSelect(sel, items, value) {
  sel.textContent = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.code;
    o.textContent = it.name;
    sel.appendChild(o);
  }
  if (value != null && [...sel.options].some(o => o.value === value)) sel.value = value;
}

function formatSize(kb) {
  if (kb == null) return '–';
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
