/** 内联 SVG 图标集（无任何外部依赖）。所有图标默认 16×16，随 currentColor 着色。 */

const svg = (path, extra = '') =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;

export const ICONS = {
  folder: svg('<path d="M1.8 3.6h4l1.4 1.8h7v7.2H1.8z"/><path d="M1.8 3.6v9.4"/>'),
  minus: svg('<path d="M3.5 8h9"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  gear: svg(
    '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5"/>'
  ),
  copy: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>'
  ),
  refresh: svg('<path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8"/><path d="M13.6 2.6v3.2h-3.2"/>'),
  trash: svg(
    '<path d="M2.8 4.4h10.4M6.4 4.4V3.2a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.2M4.2 4.4l.6 8.2a.9.9 0 0 0 .9.8h4.6a.9.9 0 0 0 .9-.8l.6-8.2"/>'
  ),
  page: svg('<path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3"/>'),
  chevronDown: svg('<path d="M4 6.2 8 10l4-3.8"/>'),
  chevronUp: svg('<path d="M4 9.8 8 6l4 3.8"/>'),
  chevronRight: svg('<path d="M6.2 4 10 8l-3.8 4"/>'),
  x: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  check: svg('<path d="M3 8.6 6.4 12 13 4.8"/>'),
  alert: svg(
    '<path d="M8 1.8 14.6 13.4H1.4z"/><path d="M8 6.4v3.2M8 11.6v.1"/>'
  ),
  spinner: svg(
    '<path d="M8 1.8a6.2 6.2 0 1 1-4.38 1.82" />',
    'class="spin"'
  ),
  eye: svg(
    '<path d="M1.6 8s2.3-4 6.4-4 6.4 4 6.4 4-2.3 4-6.4 4S1.6 8 1.6 8z"/><circle cx="8" cy="8" r="1.7"/>'
  ),
  eyeOff: svg(
    '<path d="M6.4 3.1A6.9 6.9 0 0 1 8 3c4.1 0 6.4 4 6.4 4a12 12 0 0 1-2.1 2.6M4.2 4.4A11.8 11.8 0 0 0 1.6 7s2.3 4 6.4 4a6.6 6.6 0 0 0 2.3-.4"/><path d="M2.6 13.4 13.4 2.6"/>'
  ),
  document: svg(
    '<path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3"/><path d="M5.4 8h5.2M5.4 10.4h5.2"/>'
  ),
  languages: svg(
    '<path d="M1.8 3.6h6.4M5 1.8v1.8M7.2 3.6c0 3.4-2.2 6-5.4 7.2M3.2 7c.9 1.7 2.4 3 4.4 3.8"/><path d="M8.6 14.2l2.9-7.4 2.9 7.4M9.8 11.6h3.6"/>'
  ),
  zap: svg('<path d="M8.8 1.6 3.4 9h4l-.6 5.4L12.6 7h-4z"/>'),
  save: svg(
    '<path d="M2.8 2.8h8.1L13.2 5.1v8.1H2.8z"/><path d="M5.3 2.8v3.4h5V2.8M5.3 13.2v-3.9h5.4v3.9"/>'
  ),
  note: svg('<path d="M2.8 2.8h10.4v6.6H7.4l-3.3 3v-3H2.8z"/>'),
};
