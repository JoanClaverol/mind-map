import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { buildIndex, comboFromEvent, resolveCommand } from '../hotkeys/dispatcher';
import { DEFAULT_KEYMAP, loadKeymapOverrides, resolveKeymap } from '../hotkeys/keymap';
import type { FolderInfo, MapMeta } from '../model/types';
import { runCommandById } from '../state/registry';
import { useStore } from '../state/store';
import { refreshGallery } from './galleryData';
import { setGalleryDom } from './galleryDom';
import { getCollapsedFolders, getLastOpened } from './recents';
import { buildSections, fuzzyFilter, fuzzyMatchNames, visibleOrder } from './sections';

const HINTS =
  'j/k move · ↩ open · n new · f folder · m move · h/l fold · / search · p pin · r rename · d delete · ? help';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface RowProps {
  m: MapMeta;
  selected: boolean;
  renaming: boolean;
}

function MapRow({ m, selected, renaming }: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [renameTitle, setRenameTitle] = useState(m.title);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useEffect(() => {
    if (renaming) setRenameTitle(m.title);
  }, [renaming, m.title]);

  const commitRename = async () => {
    const title = renameTitle.trim();
    useStore.getState().setGalleryRenaming(null);
    setGalleryFocus();
    if (!title || title === m.title) return;
    try {
      await api.renameMap(m.id, title);
      await refreshGallery();
    } catch (e) {
      useStore.getState().addToast('error', `Rename failed: ${(e as Error).message}`);
    }
  };

  const actOn = (commandId: string) => {
    useStore.getState().selectGalleryMap(m.id);
    runCommandById(commandId);
  };

  return (
    <li ref={ref} className={selected ? 'selected' : undefined}>
      <button
        className={`gallery-pin${m.pinned ? ' pinned' : ''}`}
        title={m.pinned ? 'Unpin' : 'Pin'}
        onClick={() => actOn('gallery.togglePin')}
      >
        ★
      </button>
      {renaming ? (
        <input
          className="gallery-rename"
          autoFocus
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            if (e.key === 'Escape') {
              setRenameTitle(m.title);
              useStore.getState().setGalleryRenaming(null);
              setGalleryFocus();
            }
          }}
        />
      ) : (
        <a className="gallery-title" href={`#/map/${m.id}`}>
          {m.title}
        </a>
      )}
      <span className="gallery-meta">
        {m.nodeCount} nodes · {formatDate(m.updatedAt)}
      </span>
      <span className="gallery-actions">
        <button onClick={() => actOn('gallery.move')}>move</button>
        <button onClick={() => actOn('gallery.rename')}>rename</button>
        <button className="danger" onClick={() => actOn('gallery.delete')}>
          delete
        </button>
      </span>
    </li>
  );
}

/** Return keyboard focus to the gallery root (after inputs blur or rows vanish). */
function setGalleryFocus(): void {
  document.querySelector<HTMLElement>('.gallery')?.focus();
}

type PickerOption = { kind: 'uncat' | 'folder' | 'create'; label: string; name?: string };

/** Keyboard-driven folder chooser for the selected map. */
function FolderPicker({ mapId, folders }: { mapId: string; folders: FolderInfo[] }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);

  const options = useMemo<PickerOption[]>(() => {
    const q = query.trim();
    const names = folders.map((f) => f.name);
    const opts: PickerOption[] = [];
    if (!q || 'uncategorized'.includes(q.toLowerCase())) opts.push({ kind: 'uncat', label: 'Uncategorized' });
    for (const name of fuzzyMatchNames(names, q)) opts.push({ kind: 'folder', label: name, name });
    if (q && !names.some((n) => n.toLowerCase() === q.toLowerCase())) {
      opts.push({ kind: 'create', label: `Create “${q}”`, name: q });
    }
    return opts;
  }, [query, folders]);

  const clamped = Math.min(sel, Math.max(options.length - 1, 0));

  const choose = async (opt: PickerOption | undefined) => {
    useStore.getState().closeFolderPicker();
    setGalleryFocus();
    if (!opt) return;
    try {
      await api.setFolder(mapId, opt.kind === 'uncat' ? null : opt.name!);
      await refreshGallery();
    } catch (e) {
      useStore.getState().addToast('error', `Move failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="gallery-picker-backdrop" onClick={() => useStore.getState().closeFolderPicker()}>
      <div className="gallery-folder-picker" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Move to folder — type to filter or create"
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              useStore.getState().closeFolderPicker();
              setGalleryFocus();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void choose(options[clamped]);
            }
          }}
        />
        <ul className="gallery-picker-list">
          {options.map((opt, i) => (
            <li
              key={`${opt.kind}:${opt.label}`}
              className={i === clamped ? 'selected' : undefined}
              onClick={() => void choose(opt)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Gallery() {
  const maps = useStore((s) => s.galleryMaps);
  const folders = useStore((s) => s.galleryFolders);
  const search = useStore((s) => s.gallerySearch);
  const selectedId = useStore((s) => s.gallerySelectedId);
  const renamingId = useStore((s) => s.galleryRenamingId);
  const collapsed = useStore((s) => s.galleryCollapsed);
  const picker = useStore((s) => s.galleryFolderPicker);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);

  const keymapIndex = useMemo(() => buildIndex(resolveKeymap(DEFAULT_KEYMAP, loadKeymapOverrides())), []);

  useEffect(() => {
    refreshGallery().then(
      () => setError(null),
      (e: Error) => setError(e.message),
    );
    const s = useStore.getState();
    s.setGallerySearch(''); // stale filter from a previous visit would hide maps
    s.setGalleryRenaming(null);
    s.setGalleryCollapsed(new Set(getCollapsedFolders()));
    s.closeFolderPicker();
    if (rootRef.current && searchRef.current && newInputRef.current && newFolderRef.current) {
      setGalleryDom({
        root: rootRef.current,
        search: searchRef.current,
        newTitle: newInputRef.current,
        newFolder: newFolderRef.current,
      });
    }
    rootRef.current?.focus();
    return () => setGalleryDom(null);
  }, []);

  // First-run: nothing to navigate, so put the cursor where typing helps.
  useEffect(() => {
    if (maps && maps.length === 0) newInputRef.current?.focus();
  }, [maps]);

  // lastOpened is re-read per refresh: opening a map rewrites it before we return here.
  const lastOpened = useMemo(() => getLastOpened(), [maps]);
  const folderList = folders ?? [];
  const searching = search.trim().length > 0;
  const order = useMemo(
    () => (maps ? visibleOrder(maps, search, lastOpened, folderList, collapsed) : []),
    [maps, search, lastOpened, folderList, collapsed],
  );
  const sections = useMemo(
    () => (maps && !searching ? buildSections(maps, lastOpened, folderList) : null),
    [maps, searching, lastOpened, folderList],
  );
  const filtered = useMemo(() => (maps && searching ? fuzzyFilter(maps, search) : null), [maps, searching, search]);

  // Keep the selection on a visible row.
  useEffect(() => {
    if (!maps) return;
    if (order.length === 0) {
      if (selectedId !== null) useStore.getState().selectGalleryMap(null);
    } else if (!selectedId || !order.some((m) => m.id === selectedId)) {
      useStore.getState().selectGalleryMap(order[0].id);
    }
  }, [maps, order, selectedId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (useStore.getState().helpOpen) return; // overlay owns the keyboard
    if (useStore.getState().galleryFolderPicker) return; // picker owns the keyboard
    if ((e.target as HTMLElement).tagName === 'INPUT') return; // inputs own their keys
    const commandId = resolveCommand(keymapIndex, 'gallery', comboFromEvent(e));
    if (commandId) {
      e.preventDefault();
      runCommandById(commandId);
    }
  };

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const map = await api.createMap(title);
      window.location.hash = `#/map/${map.id}`;
    } catch (e) {
      useStore.getState().addToast('error', `Could not create map: ${(e as Error).message}`);
    }
  };

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    try {
      await api.createFolder(name);
      setNewFolder('');
      await refreshGallery();
      setGalleryFocus();
    } catch (e) {
      useStore.getState().addToast('error', `Could not create folder: ${(e as Error).message}`);
    }
  };

  const renderList = (items: MapMeta[]) => (
    <ul className="gallery-list">
      {items.map((m) => (
        <MapRow key={m.id} m={m} selected={m.id === selectedId} renaming={m.id === renamingId} />
      ))}
    </ul>
  );

  return (
    <div className="gallery" ref={rootRef} tabIndex={0} onKeyDown={onKeyDown}>
      <h1>Mind maps</h1>
      <div className="gallery-search">
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => useStore.getState().setGallerySearch(e.target.value)}
          placeholder="/ search maps"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              useStore.getState().setGallerySearch('');
              setGalleryFocus();
            }
            if (e.key === 'Enter') runCommandById('gallery.open');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              runCommandById(e.key === 'ArrowDown' ? 'gallery.down' : 'gallery.up');
            }
          }}
        />
      </div>
      <form
        className="gallery-new"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          ref={newInputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New map title — Enter to start brainstorming"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setGalleryFocus();
          }}
        />
        <button type="submit">Create</button>
      </form>
      <form
        className="gallery-newfolder"
        onSubmit={(e) => {
          e.preventDefault();
          void createFolder();
        }}
      >
        <input
          ref={newFolderRef}
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          placeholder="New folder name — f to focus"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setNewFolder('');
              setGalleryFocus();
            }
          }}
        />
        <button type="submit">Add folder</button>
      </form>

      {error && (
        <p className="gallery-error">
          Could not load maps: {error}{' '}
          <button onClick={() => refreshGallery().then(() => setError(null), (e: Error) => setError(e.message))}>
            Retry
          </button>
        </p>
      )}
      {maps && maps.length === 0 && <p className="gallery-empty">No maps yet — create your first one above.</p>}
      {filtered && filtered.length === 0 && <p className="gallery-empty">No maps match “{search}”.</p>}

      {filtered && renderList(filtered)}
      {sections &&
        sections.map((sec) => {
          const isCollapsed = sec.collapsible && collapsed.has(sec.key);
          return (
            <section className="gallery-section" key={sec.key}>
              {sec.label &&
                (sec.collapsible ? (
                  <h2
                    className="gallery-folder-header"
                    onClick={() => useStore.getState().toggleGalleryCollapsed(sec.key)}
                  >
                    <span className="gallery-caret">{isCollapsed ? '▸' : '▾'}</span>
                    {sec.label}
                    <span className="gallery-folder-count">{sec.items.length}</span>
                  </h2>
                ) : (
                  <h2>{sec.label}</h2>
                ))}
              {!isCollapsed &&
                (sec.items.length > 0 ? (
                  renderList(sec.items)
                ) : sec.collapsible ? (
                  <p className="gallery-folder-empty">empty — press m on a map to move it here</p>
                ) : null)}
            </section>
          );
        })}

      {maps && maps.length > 0 && <div className="gallery-hints">{HINTS}</div>}

      {picker && maps?.some((m) => m.id === picker.mapId) && (
        <FolderPicker mapId={picker.mapId} folders={folderList} />
      )}
    </div>
  );
}
