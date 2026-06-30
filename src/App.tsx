import { useEffect, useState } from 'react';
import { api } from './api/client';
import { discardRecording } from './audio/recorder';
import { MindMapCanvas } from './canvas/MindMapCanvas';
import { ChatPanel } from './components/ChatPanel';
import { HelpOverlay } from './components/HelpOverlay';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toast';
import { TranscriptPanel } from './components/TranscriptPanel';
import { Gallery } from './gallery/Gallery';
import { markOpened } from './gallery/recents';
import { flushNow, initAutosave } from './state/autosave';
import { useStore } from './state/store';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function Editor({ mapId }: { mapId: string }) {
  const loadedId = useStore((s) => s.mapId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (useStore.getState().mapId !== mapId) {
      api
        .getMap(mapId)
        .then((map) => {
          if (cancelled) return;
          useStore.getState().loadMap(map);
          markOpened(map.id);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  useEffect(() => {
    const cleanup = initAutosave();
    // A missed drop must not navigate the tab away from the map.
    const preventNav = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', preventNav);
    window.addEventListener('drop', preventNav);
    return () => {
      flushNow(); // last save before leaving the editor
      cleanup();
      window.removeEventListener('dragover', preventNav);
      window.removeEventListener('drop', preventNav);
      discardRecording(); // release the mic if leaving mid-recording
      useStore.getState().setAudio(null);
      useStore.getState().closeMap();
    };
  }, []);

  if (error) {
    return (
      <div className="screen-message">
        <p>Could not open map: {error}</p>
        <a href="#/">← Back to gallery</a>
      </div>
    );
  }
  if (loadedId !== mapId) return <div className="screen-message">Loading…</div>;
  return (
    <>
      <MindMapCanvas />
      <ChatPanel />
      <TranscriptPanel />
      <StatusBar />
    </>
  );
}

export function App() {
  const route = useHashRoute();
  const match = route.match(/^#\/map\/([A-Za-z0-9_-]+)/);
  return (
    <div className="app">
      {match ? <Editor key={match[1]} mapId={match[1]} /> : <Gallery />}
      <HelpOverlay />
      <Toasts />
    </div>
  );
}
