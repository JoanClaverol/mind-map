import { LAYOUT_STYLES, SCHEMA_VERSION, normalizeFolderName, type LayoutStyle, type MapFile } from './types';

export class MigrationError extends Error {}

/**
 * Upgrade a raw parsed map file to the current schema, version by version.
 * Files without a recognizable schemaVersion are rejected rather than guessed at.
 */
export function migrateMapFile(raw: unknown): MapFile {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('map file is not an object');
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number') {
    throw new MigrationError('map file has no schemaVersion');
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(`map file schemaVersion ${version} is newer than supported ${SCHEMA_VERSION}`);
  }
  // Future migrations chain here: if (version === 1) raw = migrate1to2(raw); ...
  const map = raw as MapFile;
  if (typeof map.id !== 'string' || typeof map.title !== 'string' || typeof map.root !== 'object') {
    throw new MigrationError('map file is missing required fields');
  }
  // Tolerate hand-edited layout values: unknown ones fall back to the default.
  if (map.layout !== undefined && !LAYOUT_STYLES.includes(map.layout as LayoutStyle)) {
    delete map.layout;
  }
  if (map.pinned !== undefined && typeof map.pinned !== 'boolean') {
    delete map.pinned;
  }
  // Tolerate hand-edited folder names: normalize, drop empty/invalid ones.
  if (map.folder !== undefined) {
    const folder = normalizeFolderName(map.folder);
    if (folder) map.folder = folder;
    else delete map.folder;
  }
  // Tolerate hand-edited relationships: keep well-formed entries, drop the rest.
  if (Array.isArray(map.relationships)) {
    map.relationships = map.relationships.filter(
      (r) => r && typeof r.id === 'string' && typeof r.from === 'string' && typeof r.to === 'string',
    );
  } else if (map.relationships !== undefined) {
    delete map.relationships;
  }
  return map;
}
