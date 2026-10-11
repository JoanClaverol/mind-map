import kalam400 from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import kalam700 from '@fontsource/kalam/files/kalam-latin-700-normal.woff2?url';
import { getCanvasHost } from './layoutCache';
import { SKETCH_FONT } from './sketch';

/**
 * Export the canvas as a standalone image. Works off the live SVG (what you
 * see is what you get — hoist and pinned filters included) rather than
 * re-rendering, so nodes, edges, arrows, and groups can never drift from the
 * on-screen look:
 *   clone the <svg> → drop interaction state → re-frame the content group to
 *   its bounding box → inline the app stylesheet + a background.
 * PNG rasterizes that SVG through an <img> + <canvas> (node text lives in
 * <foreignObject>, which Chromium and Firefox rasterize without tainting).
 */
const PADDING = 32;
/** Interaction-only classes: an export shows the map, not the cursor. */
const STATE_CLASSES = ['selected', 'dimmed', 'link-source', 'group-member'];
/** Canvas pixel cap (Safari's limit is ~16.7M px); larger maps scale down. */
const MAX_PIXELS = 16_000_000;

export type SvgExport = { svg: string; width: number; height: number };

function appStylesheet(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        // The app's @font-face rules point at URLs an image-rendered SVG can't
        // load — and they'd shadow the embedded data-URL faces, blanking all text.
        if (rule instanceof CSSFontFaceRule) continue;
        parts.push(rule.cssText);
      }
    } catch {
      // cross-origin sheet (none today) — skip rather than fail the export
    }
  }
  // CSSOM serializes type selectors lowercased; in a standalone (XML) SVG they
  // match case-sensitively, so `foreignobject` would miss <foreignObject>.
  return parts.join('\n').replace(/foreignobject/gi, 'foreignObject');
}

let embeddedFontCss: Promise<string> | null = null;

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * An image-rendered SVG can't fetch anything, so the sketch font must travel
 * inside it as data URLs (latin subset, ~25 KB per weight). Loaded once.
 */
function sketchFontCss(): Promise<string> {
  embeddedFontCss ??= Promise.all([dataUrl(kalam400), dataUrl(kalam700)]).then(
    ([regular, bold]) =>
      `@font-face{font-family:'${SKETCH_FONT}';font-weight:400;src:url(${regular}) format('woff2')}` +
      `@font-face{font-family:'${SKETCH_FONT}';font-weight:700;src:url(${bold}) format('woff2')}`,
  );
  return embeddedFontCss;
}

export async function buildSvg(): Promise<SvgExport | null> {
  const host = getCanvasHost();
  const live = host?.querySelector<SVGSVGElement>(':scope > svg');
  const content = live?.querySelector<SVGGElement>(':scope > g');
  if (!host || !live || !content) return null;
  // getBBox ignores the element's own transform (pan/zoom) — content coordinates.
  const box = content.getBBox();
  if (box.width === 0 && box.height === 0) return null;
  const width = Math.ceil(box.width + PADDING * 2);
  const height = Math.ceil(box.height + PADDING * 2);

  const svg = live.cloneNode(true) as SVGSVGElement;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const group = svg.querySelector(':scope > g')!;
  group.setAttribute('transform', `translate(${PADDING - box.x},${PADDING - box.y})`);
  svg.querySelectorAll('.pending, .element-selection, .element-resize').forEach((el) => el.remove());
  for (const cls of STATE_CLASSES) svg.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));

  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
  const sketch = document.documentElement.dataset.theme === 'sketch';
  // Theme selectors are `:root[data-theme=…]` — in a standalone SVG, :root is the <svg>.
  if (sketch) svg.setAttribute('data-theme', 'sketch');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = (sketch ? await sketchFontCss() : '') + appStylesheet();
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', bg);
  svg.insertBefore(background, svg.firstChild);
  svg.insertBefore(style, svg.firstChild);

  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

export async function svgToPng({ svg, width, height }: SvgExport, scale = 2): Promise<Blob> {
  const s = Math.min(scale, Math.sqrt(MAX_PIXELS / (width * height)));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s);
  canvas.height = Math.round(height * s);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(s, s);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

export function exportFileName(title: string, ext: 'svg' | 'png'): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${slug || 'mind-map'}.${ext}`;
}

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
