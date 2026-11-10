/** 右上角 toast：可堆叠，3s 自动消失。 */
import { ICONS } from './icons.js';

const root = () => document.getElementById('toasts');

/**
 * @param {string} msg
 * @param {'info'|'success'|'error'} [type]
 * @param {number} [ms]
 */
export function toast(msg, type = 'info', ms = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? ICONS.check : type === 'error' ? ICONS.alert : ICONS.zap;
  el.innerHTML = `<span class="ic">${icon}</span><span class="t-body"></span>`;
  el.querySelector('.t-body').textContent = msg;
  root().appendChild(el);

  const kill = () => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(kill, ms);
  el.addEventListener('click', () => { clearTimeout(timer); kill(); });
  return el;
}
