import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { getCanvasHost } from '../canvas/layoutCache';
import type { ChatItem } from '../model/chat';
import { useStore } from '../state/store';
import { renderChatMarkdown } from './chatMarkdown';
import { useChat } from './chatStore';

const SUGGESTIONS = [
  'Make a mind map about planning a product launch',
  'Expand the selected branch with 4 ideas',
  'Challenge this map: mark weak spots with ❓',
  'Sketch an n8n-style workflow for triaging support emails',
];

/** Return keyboard focus to the canvas (or the gallery) — the panel stays as it is. */
function focusMain(): void {
  const host = getCanvasHost();
  if (host) host.focus();
  else (document.querySelector('.gallery') as HTMLElement | null)?.focus();
}

/**
 * The in-app AI chat: a side panel next to the canvas, collapsible to a slim
 * bar (⌘J) so the whole map is free to navigate. The conversation runs in
 * omp on the server (server/agent.ts); edits arrive through live sync like any
 * MCP client's, and a whole reply is one undo step.
 */
export function ChatPanel() {
  const { open, status, model, items, error, focusTick, setOpen } = useChat();
  const mapId = useStore((s) => s.mapId);
  const title = useStore((s) => s.title);
  const selectedText = useStore((s) => (s.doc && s.selectedId && s.selectedId !== s.doc.rootId ? s.doc.nodes[s.selectedId]?.text : null));
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const busy = status === 'busy' || status === 'starting' || sending;

  // Let the rest of the layout (inspector, toasts) make room for the panel.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--chat-w', open ? 'var(--chat-open-w)' : 'var(--chat-closed-w)');
  }, [open]);

  useEffect(() => {
    if (open && focusTick > 0) inputRef.current?.focus();
  }, [focusTick, open]);

  // Follow the stream unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [items, open]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setSending(true);
    setDraft('');
    const s = useStore.getState();
    try {
      await api.chatSend(t, s.mapId, s.selectedId);
    } catch (err) {
      setDraft(t);
      useStore.getState().addToast('error', err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the canvas/gallery must not see keys typed in the chat
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      setOpen(false);
      focusMain();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (status === 'busy') void api.chatCancel();
      else focusMain();
    }
  };

  if (!open) {
    return (
      <aside className="chat-bar" onKeyDown={onKeyDown}>
        <button className="chat-bar-button" onClick={() => setOpen(true, true)} title="Open the AI chat (⌘J)">
          <span className="chat-bar-icon">✦</span>
          <span className="chat-bar-label">AI chat</span>
          {busy && <span className="chat-dot busy" />}
        </button>
      </aside>
    );
  }

  const where = mapId ? `${title}${selectedText ? ` › ${selectedText.replace(/\s+/g, ' ').slice(0, 40)}` : ''}` : 'Gallery';

  return (
    <aside className="chat-panel" onKeyDown={onKeyDown}>
      <header className="chat-header">
        <div className="chat-heading">
          <strong>AI chat</strong>
          <span className="chat-model">{status === 'unavailable' ? 'not connected' : (model ?? 'omp')}</span>
        </div>
        <button className="chat-icon-button" onClick={() => void api.chatReset()} title="New conversation" disabled={busy && status !== 'busy'}>
          ＋
        </button>
        <button
          className="chat-icon-button"
          onClick={() => {
            setOpen(false);
            focusMain();
          }}
          title="Collapse (⌘J)"
        >
          »
        </button>
      </header>

      <div className="chat-log" ref={logRef}>
        {items.length === 0 ? (
          <div className="chat-empty">
            <p>Tell me what to map — I'll draw it on the canvas while you watch. Everything I do is one ⌘Z away.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chat-suggestion" onClick={() => void send(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          items.map((item) => <ChatItemView key={item.id} item={item} />)
        )}
        {busy && <div className="chat-working">{status === 'starting' ? 'Starting the AI…' : 'Working…'}</div>}
        {status === 'unavailable' && error && <div className="chat-unavailable">{error}</div>}
      </div>

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className="chat-context" title="Sent with your message so “this” means what you're looking at">
          {where}
        </div>
        <textarea
          ref={inputRef}
          value={draft}
          rows={3}
          placeholder={mapId ? 'Ask about this map, or tell me what to change…' : 'What should we map?'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className="chat-actions">
          <span className="chat-hint">Enter to send · ⇧Enter new line · Esc back to map</span>
          {status === 'busy' ? (
            <button type="button" className="chat-stop" onClick={() => void api.chatCancel()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="chat-send" disabled={!draft.trim() || busy}>
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

function ChatItemView({ item }: { item: ChatItem }) {
  const html = useMemo(() => (item.kind === 'text' ? renderChatMarkdown(item.text) : ''), [item]);
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-msg user">
          <div className="chat-bubble">{item.text}</div>
          {item.context && <div className="chat-msg-context">{item.context}</div>}
        </div>
      );
    case 'text':
      return <div className="chat-msg ai" dangerouslySetInnerHTML={{ __html: html }} />;
    case 'tool': {
      const icon = item.status === 'completed' ? '✓' : item.status === 'failed' ? '✕' : '…';
      return (
        <div className={`chat-tool ${item.status}`}>
          <span className="chat-tool-icon">{icon}</span> {item.title}
        </div>
      );
    }
    case 'permission':
      return (
        <div className={`chat-permission ${item.state}`}>
          <div className="chat-permission-title">{item.title}</div>
          {item.detail && <code className="chat-permission-detail">{item.detail}</code>}
          {item.state === 'pending' ? (
            <div className="chat-permission-actions">
              <button onClick={() => void api.chatPermission(item.id, true)}>Allow</button>
              <button onClick={() => void api.chatPermission(item.id, false)}>Reject</button>
            </div>
          ) : (
            <div className="chat-permission-state">{item.state === 'allowed' ? 'Allowed' : 'Rejected'}</div>
          )}
        </div>
      );
    case 'error':
      return <div className="chat-error">{item.text}</div>;
  }
}
