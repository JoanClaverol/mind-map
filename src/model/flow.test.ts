import { describe, expect, it } from 'vitest';
import { FLOW_GAP_X, edgeLabelWidth, layoutTree, type Size } from '../layout/layout';
import { denormalize, normalize } from './doc';
import { renderNodeContent } from './inline-markdown';
import { applyFlowMarkers, branchToMarkdown, markdownToBranches } from './markdown';
import { migrateMapFile } from './migrate';
import { applyDocOp } from './ops';
import { SCHEMA_VERSION, type FileNode } from './types';

const n = (id: string, children: FileNode[] = [], extra: Partial<FileNode> = {}): FileNode => ({
  id,
  text: id,
  children,
  ...extra,
});
const size = (): Size => ({ w: 100, h: 30 });

describe('flow layout', () => {
  const tree = n('trigger', [n('classify', [n('urgent', [], { edgeLabel: 'yes' }), n('reply', [], { edgeLabel: 'no' })])]);

  it('lays steps out left to right and marks every edge as a flow edge', () => {
    const doc = normalize(tree, 'flow');
    const l = layoutTree(doc, size);
    const t = l.rects.get('trigger')!;
    const c = l.rects.get('classify')!;
    expect(c.x).toBe(t.x + t.w + FLOW_GAP_X);
    expect(l.rects.get('urgent')!.x).toBeGreaterThan(c.x + c.w);
    expect([...l.flowEdges].sort()).toEqual(['classify', 'reply', 'urgent']);
    expect(l.dirs.get('urgent')).toBe('right');
  });

  it('widens the gap so the longest edge label fits', () => {
    const label = 'the full customer email body text';
    const doc = normalize(n('a', [n('b', [], { edgeLabel: label })]), 'flow');
    const l = layoutTree(doc, size);
    const gap = l.rects.get('b')!.x - (l.rects.get('a')!.x + 100);
    expect(gap).toBeGreaterThanOrEqual(edgeLabelWidth(label) + 20);
  });

  it('works as a branch override inside a logic chart', () => {
    const doc = normalize(n('root', [n('plan'), n('wf', [n('s1', [n('s2')])], { style: 'flow' })]));
    const l = layoutTree(doc, size);
    expect(l.flowEdges.has('s1')).toBe(true);
    expect(l.flowEdges.has('s2')).toBe(true);
    expect(l.flowEdges.has('wf')).toBe(false); // the edge into wf belongs to the logic chart
  });

  it('draws no flow edges in other layouts', () => {
    expect(layoutTree(normalize(tree), size).flowEdges.size).toBe(0);
  });
});

describe('step and edge label metadata', () => {
  it('set_node_meta validates and clears step / edgeLabel', () => {
    const doc = normalize(n('a', [n('b')]));
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', step: 'ai', edgeLabel: '  email   body ' }).ok).toBe(true);
    expect(doc.nodes.b).toMatchObject({ step: 'ai', edgeLabel: 'email body' });
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', step: 'robot' as never }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', edgeLabel: 'x'.repeat(41) }).ok).toBe(false);
    applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', step: null, edgeLabel: '' });
    expect(doc.nodes.b.step).toBeUndefined();
    expect(doc.nodes.b.edgeLabel).toBeUndefined();
  });

  it('round-trips through the file format and salvages bad values', () => {
    const doc = normalize(n('a', [n('b', [], { step: 'tool', edgeLabel: 'rows' })]));
    expect(denormalize(doc).children[0]).toMatchObject({ step: 'tool', edgeLabel: 'rows' });
    const map = migrateMapFile({
      schemaVersion: SCHEMA_VERSION,
      id: 'abcdef',
      title: 't',
      createdAt: '',
      updatedAt: '',
      root: { id: 'r', text: 'r', step: 'wizard', edgeLabel: 42, children: [] },
    } as never);
    expect(map.root.step).toBeUndefined();
    expect(map.root.edgeLabel).toBeUndefined();
  });

  it('renders a step badge in the measured node content', () => {
    expect(renderNodeContent('Classify', undefined, 'ai')).toContain('class="node-step step-ai">AI</span>');
    expect(renderNodeContent('Classify', undefined, 'bogus')).not.toContain('node-step');
  });
});

describe('workflow outline markers', () => {
  it('parse step types (with aliases) and incoming labels', () => {
    const branches = markdownToBranches(
      '- [trigger] New email\n  - [AI] Classify <- email body\n    - [if] Urgent? <- category\n      - [api] Page on-call ← yes\n  - [maybe] Keep as text',
    );
    applyFlowMarkers(branches);
    const root = branches[0];
    expect(root).toMatchObject({ text: 'New email', step: 'trigger' });
    const classify = root.children[0];
    expect(classify).toMatchObject({ text: 'Classify', step: 'ai', edgeLabel: 'email body' });
    expect(classify.children[0]).toMatchObject({ text: 'Urgent?', step: 'condition', edgeLabel: 'category' });
    expect(classify.children[0].children[0]).toMatchObject({ text: 'Page on-call', step: 'tool', edgeLabel: 'yes' });
    expect(root.children[1]).toMatchObject({ text: '[maybe] Keep as text' });
    expect(root.children[1].step).toBeUndefined();
  });

  it('read_map_markdown shows them back in the same syntax', () => {
    const doc = normalize(n('a', [n('b', [], { step: 'ai', edgeLabel: 'body' })]));
    expect(branchToMarkdown(doc, 'a', { meta: true })).toBe('- a\n  - [ai] b <- body');
  });
});
