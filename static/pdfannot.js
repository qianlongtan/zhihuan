// pdfannot.js — 把高亮标注与备忘录写入真实 PDF（完全离线，pdf-lib ESM）
// 导出契约：writeAnnotations(pdfBytes, annots) -> Promise<Uint8Array>
//          canAnnotate(pdfBytes) -> Promise<{ok:boolean, reason?:string}>
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
} from './vendor/pdf-lib/pdf-lib.esm.js';

const AUTHOR = '知幻';
const DEFAULT_COLOR = [1, 0.93, 0.23]; // 缺省荧光黄
const DEFAULT_OPACITY = 0.35;
const NOTE_ICON_SIZE = 24; // 便签图标边长（pt）

/** 当前 UTC 时间的 PDF 日期串：D:YYYYMMDDHHmmSSZ */
function pdfDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * 取 viewer 可视区域（CropBox，缺省回退 MediaBox）。
 * 坐标坑说明： annot 的 rects 是 CSS 再现坐标，viewer 以 CropBox 为可视
 * 区域；同时部分页面的 MediaBox/CropBox 原点不在 (0,0)，/Rect 注释坐标
 * 按规范写"default user space"，必须叠加 box 原点偏移。pdf-lib 的
 * getCropBox() 在页面没有 CropBox 时自动回退 MediaBox，正好匹配。
 */
function getViewBox(page) {
  return (page.getCropBox && page.getCropBox()) || page.getMediaBox();
}

/** CSS 坐标（原点左上、y 向下）→ PDF 坐标（原点左下、y 向上） */
function cssToPdf(box, x, y) {
  return [box.x + x, box.y + box.height - y];
}

/**
 * 一个矩形（跨行选区中的一行）的 QuadPoints 段：8 个 PDF 坐标数。
 * 顺序采用 Adobe 约定：左上 → 右上 → 左下 → 右下。
 */
function rectToQuad(box, rect) {
  const x0 = Math.min(rect[0], rect[2]);
  const x1 = Math.max(rect[0], rect[2]);
  const y0 = Math.min(rect[1], rect[3]);
  const y1 = Math.max(rect[1], rect[3]);
  const [left, top] = cssToPdf(box, x0, y0);
  const [right, bottom] = cssToPdf(box, x1, y1);
  return [left, top, right, top, left, bottom, right, bottom];
}

/** 多矩形的 /Rect：所有 quad 端点的包围盒（PDF 坐标） */
function boundingRect(quads) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < quads.length; i += 2) {
    xs.push(quads[i]);
    ys.push(quads[i + 1]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function numArray(ctx, values) {
  return ctx.obj(values.map((n) => PDFNumber.of(n)));
}

/** 把一条 annot 写入指定页面 */
function writeOneAnnot(pdfDoc, page, a) {
  const box = getViewBox(page);
  const rects = (a.rects || []).filter(
    (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite),
  );
  if (!rects.length) return false;

  const ctx = pdfDoc.context;
  const color = Array.isArray(a.color) && a.color.length === 3 ? [...a.color] : [...DEFAULT_COLOR];
  const opacity = a.opacity == null ? DEFAULT_OPACITY : a.opacity;

  // —— 高亮：手工构造 /Subtype /Highlight 字典（pdf-lib 无现成封装）——
  let quads = [];
  for (const r of rects) quads.push(...rectToQuad(box, r));
  const rect = boundingRect(quads);

  const hiDict = ctx.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Highlight'),
    Rect: numArray(ctx, rect),
    QuadPoints: numArray(ctx, quads),
    C: numArray(ctx, color),
    CA: PDFNumber.of(opacity),
    T: PDFHexString.fromText(AUTHOR),
    Contents: PDFHexString.fromText(a.note || a.text || ''),
    M: PDFString.of(pdfDate()),
    NM: PDFString.of(String(a.id)),
    F: PDFNumber.of(4), // Print 位
  });
  const refs = [ctx.register(hiDict)];

  // —— 备忘录：note 非空时额外加一个 /Text 便签，挂在第一个矩形右上角 ——
  if (a.note && String(a.note).trim() !== '') {
    const first = rects[0];
    const [px, py] = cssToPdf(box, Math.max(first[0], first[2]), Math.min(first[1], first[3]));
    // 让图标尽量完整落在可视区内
    const bx0 = Math.min(px + 2, box.x + box.width - NOTE_ICON_SIZE);
    const by0 = Math.max(py - NOTE_ICON_SIZE, box.y);
    const noteDict = ctx.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: numArray(ctx, [bx0, by0, bx0 + NOTE_ICON_SIZE, by0 + NOTE_ICON_SIZE]),
      Contents: PDFHexString.fromText(a.note),
      T: PDFHexString.fromText(AUTHOR),
      Name: PDFName.of('Comment'),
      C: numArray(ctx, color),
      CA: PDFNumber.of(opacity),
      M: PDFString.of(pdfDate()),
      NM: PDFString.of(`${a.id}-note`),
      F: PDFNumber.of(4),
      Open: false,
    });
    refs.push(ctx.register(noteDict));
  }

  // —— 挂到页面 /Annots ——
  const existing = page.node.Annots();
  let arr;
  if (existing) {
    arr = pdfDoc.context.lookup(existing, PDFArray) || existing;
  } else {
    arr = ctx.obj([]);
    page.node.set(PDFName.of('Annots'), arr);
  }
  for (const ref of refs) arr.push(ref);
  return true;
}

/**
 * 把高亮标注和备忘录写进真实 PDF。
 *
 * @param {Uint8Array} pdfBytes  原始 PDF 字节
 * @param {Array} annots 形如：
 *   {
 *     id: string,
 *     page: number,             // 1-based
 *     color: [r,g,b],           // 0..1 浮点
 *     opacity: number,          // 0..1，缺省 0.35
 *     note: string,             // 可为空
 *     text: string,             // 被标注原文，可为空
 *     rects: [[x0,y0,x1,y1], ...] // 页面坐标系，单位为 PDF point（= scale 1 时的 CSS px），
 *                                 // 原点左上、y 向下，可能有多个矩形（跨行选区）
 *   }
 * @returns {Promise<Uint8Array>} 带注释的新 PDF
 */
/**
 * 移除本程序之前写入的注释（/T == "知幻"）。
 * 目的：允许「打开已保存过高亮的 PDF 再保存」时不会重复堆叠，
 * 同时让「删掉标注后保存」真的从文件里消失。第三方注释（如 /Link）保持不动。
 */
function stripOwnAnnotations(pdfDoc) {
  for (const page of pdfDoc.getPages()) {
    const ref = page.node.get(PDFName.of('Annots'));
    if (!ref) continue;
    const arr = pdfDoc.context.lookup(ref, PDFArray);
    if (!arr) continue;
    const kept = arr.asArray().filter((r) => {
      const d = pdfDoc.context.lookup(r);
      const t = d && typeof d.lookup === 'function' ? d.lookup(PDFName.of('T')) : null;
      if (!t) return true;
      const name = typeof t.decodeText === 'function' ? t.decodeText() : t.toString();
      return name !== AUTHOR;
    });
    const next = pdfDoc.context.obj([]);
    kept.forEach((r) => next.push(r));
    page.node.set(PDFName.of('Annots'), next);
  }
}

export async function writeAnnotations(pdfBytes, annots) {
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: false, // 加密 PDF 必须失败，不能悄悄写坏
  });
  if (!Array.isArray(annots)) annots = [];
  stripOwnAnnotations(pdfDoc);

  const pageCount = pdfDoc.getPageCount();
  for (const a of annots) {
    const pageNo = a ? Math.floor(Number(a.page)) : NaN;
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pageCount) continue; // 越页：跳过不抛
    try {
      writeOneAnnot(pdfDoc, pdfDoc.getPage(pageNo - 1), a);
    } catch (err) {
      console.error(`[pdfannot] 写入注释失败 (id=${a.id}):`, err);
    }
  }

  const out = await pdfDoc.save({ useObjectStreams: false });
  return out instanceof Uint8Array ? out : new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * 仅测算，不写文件：返回 {ok:true} 或 {ok:false, reason}
 * 用于保存前检查（例如加密 PDF 不能写）
 */
export async function canAnnotate(pdfBytes) {
  try {
    await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
    return { ok: true };
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/encrypt/i.test(msg)) {
      return { ok: false, reason: 'PDF 已加密，无法写入注释' };
    }
    return { ok: false, reason: `PDF 无法解析：${msg}` };
  }
}

export default { writeAnnotations, canAnnotate };
