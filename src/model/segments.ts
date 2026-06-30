import type { FileNode } from './types';

export interface Segment {
  text: string;
  start: number;
  end: number;
}

/**
 * Offline fallback for transcript → nodes: one sibling node per whisper
 * segment, with fragments shorter than minChars merged into the previous
 * segment so pause-induced slivers don't become their own nodes.
 * Ids are placeholders — pasteBranches regenerates them.
 */
export function segmentsToBranches(segments: { text: string }[], minChars = 20): FileNode[] {
  const texts: string[] = [];
  for (const seg of segments) {
    const t = seg.text.trim();
    if (!t) continue;
    if (texts.length > 0 && t.length < minChars) {
      texts[texts.length - 1] += ` ${t}`;
    } else {
      texts.push(t);
    }
  }
  return texts.map((text, i) => ({ id: `seg-${i}`, text, children: [] }));
}
