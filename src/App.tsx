import { useEffect, useState } from 'react';
import { api } from './api/client';
import { MindMapCanvas } from './canvas/MindMapCanvas';
import { HelpOverlay } from './components/HelpOverlay';
import { InspectorPanel } from './components/InspectorPanel';
import { SearchPanel } from './components/SearchPanel';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toast';
import { Gallery } from './gallery/Gallery';
import { markOpened } from './gallery/recents';
import { flushNow, initAutosave } from './state/autosave';
import { initLiveSync } from './state/livesync';
import { applySketchTheme, loadSketchPref } from './canvas/sketch';
import { initPresence } from './state/presence';
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

  // Live sync starts once the map is loaded; keyed remount tears it down on switch.
  useEffect(() => {
    if (loadedId !== mapId) return;
    return initLiveSync(mapId);
  }, [loadedId, mapId]);

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
      <SearchPanel />
      <InspectorPanel />
      <StatusBar />
    </>
  );
}

export function App() {
  const route = useHashRoute();
  useEffect(() => initPresence(), []);
  useEffect(() => {
    const on = loadSketchPref();
    useStore.getState().setSketch(on);
    if (on) applySketchTheme(true, () => useStore.getState().bumpMeasureEpoch());
  }, []);
  const match = route.match(/^#\/map\/([A-Za-z0-9_-]+)/);
  return (
    <div className="app">
      {match ? <Editor key={match[1]} mapId={match[1]} /> : <Gallery />}
      <HelpOverlay />
      <Toasts />
    </div>
  );
}
