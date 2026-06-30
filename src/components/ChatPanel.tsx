import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { getCanvasHost } from '../canvas/layoutCache';
import { renderChatMarkdown } from '../model/chat-markdown';
import { newId } from '../model/doc';
import { branchToMarkdown } from '../model/markdown';
import type { ChatTurn, Doc } from '../model/types';
import { useStore } from '../state/store';

/** Serialize the live map (outline + cross-links) as the LLM's grounding context. */
function buildContext(title: string, doc: Doc): string {
  let out = `# ${title}\n\n${branchToMarkdown(doc, doc.rootId)}`;
  if (doc.relationships.length > 0) {
    const rels = doc.relationships
      .map((r) => {
        const from = doc.nodes[r.from]?.text.replace(/\s+/g, ' ').trim() ?? '?';
        const to = doc.nodes[r.to]?.text.replace(/\s+/g, ' ').trim() ?? '?';
        return `- ${from} → ${to}${r.label ? ` (${r.label})` : ''}`;
      })
      .join('\n');
    out += `\n\n## Relationships\n\n${rels}`;
  }
  return out;
}

export function ChatPanel() {
  const open = useStore((s) => s.chatOpen);
  const messages = useStore((s) => s.chatMessages);
  const streaming = useStore((s) => s.chatStreaming);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    } catch {
      useStore.getState().addToast('error', 'Copy failed');
    }
  };

  // Keep the latest message in view as tokens stream in.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  if (!open) return null;

  const close = () => {
    useStore.getState().setChatOpen(false);
    getCanvasHost()?.focus();
  };

  const send = async () => {
    const s = useStore.getState();
    const input = inputRef.current;
    const question = input?.value.trim();
    if (!question || s.chatStreaming || !s.doc) return;
    const context = buildContext(s.title || 'mind map', s.doc);
    const userMsg = { id: newId(), role: 'user' as const, content: question };
    // Snapshot the turns to send *before* adding the empty assistant placeholder.
    const turns: ChatTurn[] = [...s.chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    s.addChatMessage(userMsg);
    if (input) input.value = '';
    s.addChatMessage({ id: newId(), role: 'assistant', content: '' });
    s.setChatStreaming(true);
    try {
      await api.chat(context, turns, (delta) => useStore.getState().appendToLastChatMessage(delta));
      const last = useStore.getState().chatMessages.at(-1);
      if (last && last.role === 'assistant' && !last.content.trim()) {
        useStore.getState().appendToLastChatMessage('⚠ No answer — is the LLM reachable?');
      }
    } catch (err) {
      useStore.getState().appendToLastChatMessage(`⚠ ${(err as Error).message}`);
    } finally {
      useStore.getState().setChatStreaming(false);
    }
  };

  return (
    <div
      className="chat-panel"
      onKeyDown={(e) => {
        e.stopPropagation(); // the canvas must not see keys typed in the chat
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="chat-header">
        <strong>Ask this map</strong>
        <button className="chat-close" onClick={close} title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">Ask a question to find anything in this map.</div>
        )}
        {messages.map((m) =>
          m.role === 'assistant' ? (
            <div key={m.id} className="chat-message assistant">
              {m.content.trim() ? (
                <>
                  {/* XSS-safe: renderChatMarkdown only emits fixed tags + escaped text. */}
                  <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderChatMarkdown(m.content) }} />
                  <button className="chat-copy" onClick={() => void copy(m.id, m.content)}>
                    {copiedId === m.id ? 'Copied ✓' : 'Copy'}
                  </button>
                </>
              ) : (
                <span className="chat-dots">…</span>
              )}
            </div>
          ) : (
            <div key={m.id} className="chat-message user">
              {m.content}
            </div>
          ),
        )}
      </div>
      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={2}
          placeholder="Ask… (Enter to send, Shift+Enter for newline)"
          disabled={streaming}
        />
        <button onClick={() => void send()} disabled={streaming}>
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
