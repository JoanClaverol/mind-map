import { api } from '../api/client';
import { useStore } from '../state/store';
import { pruneOpened } from './recents';

/** Reload the map list + folders into the store; shared by the component and gallery.* commands. */
export async function refreshGallery(): Promise<void> {
  const [{ maps, warnings }, { folders }] = await Promise.all([api.listMaps(), api.listFolders()]);
  const s = useStore.getState();
  s.setGalleryMaps(maps);
  s.setGalleryFolders(folders);
  for (const w of warnings) s.addToast('error', `Skipped unreadable map file: ${w}`);
  pruneOpened(maps.map((m) => m.id));
}
