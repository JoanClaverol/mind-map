import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { getCanvasHost } from '../canvas/layoutCache';
import { markdownToBranches } from '../model/markdown';
import { segmentsToBranches } from '../model/segments';
import type { FileNode } from '../model/types';
import { pasteBranches } from '../state/commands';
import { useStore, type AudioState } from '../state/store';

const REFINE_PRESETS = [
  { label: 'Clean up', instruction: 'Clean up the note: remove filler words and false starts, fix punctuation. Keep all content and the original wording where possible.' },
  { label: 'Summarize', instruction: 'Summarize the note concisely, keeping all key information.' },
  { label: 'Key points', instruction: 'Extract the key points as a flat markdown bullet list.' },
  { label: 'Fix grammar', instruction: 'Fix grammar and spelling only; change nothing else.' },
];

function countNodes(branches: FileNode[]): number {
  return branches.reduce((sum, b) => sum + 1 + countNodes(b.children), 0);
}

function RecordingPill({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(1, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="audio-pill recording">
      <span className="rec-dot" />
      {mm}:{ss} — ⇧R to stop · Esc to discard
    </div>
  );
}

function Panel({ audio }: { audio: AudioState }) {
  const busy = audio.phase === 'busy';
  const [refineOn, setRefineOn] = useState(false);
  const [prevText, setPrevText] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getConfig().then((c) => setRefineOn(c.refine)).catch(() => setRefineOn(false));
    taRef.current?.focus();
  }, []);

  const close = () => {
    useStore.getState().setAudio(null);
    getCanvasHost()?.focus();
  };

  const insert = async (mode: 'outline' | 'raw') => {
    const s = useStore.getState();
    const a = s.audio;
    const text = a?.transcript?.trim();
    if (!a || !text) return;
    s.setAudio({ ...a, phase: 'busy' });
    let branches: FileNode[] = [];
    if (mode === 'outline' && refineOn) {
      try {
        const { markdown } = await api.structure(text);
        branches = markdownToBranches(markdown);
      } catch {
        useStore.getState().addToast('info', 'AI outline failed — inserting split segments instead');
      }
    }
    if (mode === 'outline' && branches.length === 0) {
      branches = segmentsToBranches(a.segments?.length ? a.segments : [{ text, start: 0, end: 0 }]);
    }
    if (mode === 'raw') {
      branches = [{ id: 'raw', text: text.replace(/\s+/g, ' '), children: [] }];
    }
    if (branches.length === 0) {
      close();
      return;
    }
    const now = useStore.getState();
    if (!now.doc) return;
    const target = now.selectedId && now.doc.nodes[now.selectedId] ? now.selectedId : now.doc.rootId;
    now.runCommand('pasteBranches', (d) => pasteBranches(d, target, branches));
    now.addToast('success', `Inserted ${countNodes(branches)} node${countNodes(branches) === 1 ? '' : 's'}`);
    close();
  };

  const refine = async (instruction: string) => {
    const s = useStore.getState();
    const a = s.audio;
    if (!a?.transcript) return;
    setPrevText(a.transcript);
    s.setAudio({ ...a, phase: 'busy' });
    try {
      const { text } = await api.refine(a.transcript, instruction);
      useStore.getState().setAudio({ ...a, phase: 'ready', transcript: text });
    } catch (err) {
      useStore.getState().setAudio({ ...a, phase: 'ready' });
      useStore.getState().addToast('error', `Refine failed: ${(err as Error).message}`);
    }
  };

  const undoRefine = () => {
    const s = useStore.getState();
    if (prevText === null || !s.audio) return;
    s.setAudio({ ...s.audio, transcript: prevText });
    setPrevText(null);
  };

  const saveNote = async () => {
    const s = useStore.getState();
    const a = s.audio;
    if (!a?.transcript?.trim()) return;
    s.setAudio({ ...a, phase: 'busy' });
    try {
      await api.saveNote(`Nota de veu — ${s.title || 'mind map'}`, a.transcript);
      useStore.getState().addToast('success', 'Saved as note in segon-cervell');
      useStore.getState().setAudio({ ...a, phase: 'ready' });
    } catch (err) {
      useStore.getState().setAudio({ ...a, phase: 'ready' });
      useStore.getState().addToast('error', `Note save failed: ${(err as Error).message}`);
    }
  };

  return (
    <div
      className="transcript-panel"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void insert('outline');
        }
      }}
    >
      <div className="tp-header">
        <strong>Voice note</strong>
        <span className="tp-badge">
          {audio.language ?? '?'} · {audio.duration ?? '?'}s
        </span>
      </div>
      <textarea
        ref={taRef}
        value={audio.transcript ?? ''}
        rows={6}
        disabled={busy}
        onChange={(e) => {
          const s = useStore.getState();
          if (s.audio) s.setAudio({ ...s.audio, transcript: e.target.value });
        }}
      />
      <div className="tp-actions">
        <button className="primary" disabled={busy} onClick={() => void insert('outline')}>
          Insert as outline ⌘↩
        </button>
        <button disabled={busy} onClick={() => void insert('raw')}>
          Insert raw
        </button>
        {refineOn &&
          REFINE_PRESETS.map((p) => (
            <button key={p.label} disabled={busy} onClick={() => void refine(p.instruction)}>
              {p.label}
            </button>
          ))}
        {prevText !== null && (
          <button disabled={busy} onClick={undoRefine}>
            Undo refine
          </button>
        )}
        <button disabled={busy} onClick={() => void saveNote()}>
          → segon cervell
        </button>
        <button disabled={busy} onClick={close}>
          Discard esc
        </button>
      </div>
      {busy && <div className="tp-busy">Working…</div>}
    </div>
  );
}

export function TranscriptPanel() {
  const audio = useStore((s) => s.audio);
  if (!audio) return null;
  if (audio.phase === 'recording') return <RecordingPill startedAt={audio.startedAt ?? Date.now()} />;
  if (audio.phase === 'transcribing') {
    return (
      <div className="audio-pill">
        <span className="spinner" />
        Transcribing…
      </div>
    );
  }
  return <Panel audio={audio} />;
}
