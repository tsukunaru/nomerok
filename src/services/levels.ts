import type { LevelManifestEntry, PaintLevel } from '../game/types.ts';

const levelCache = new Map<string, Promise<PaintLevel>>();
let manifestPromise: Promise<readonly LevelManifestEntry[]> | null = null;

export const assetUrl = (path: string) => new URL(path, document.baseURI).href;

const fetchJson = async (path: string) => {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
};

const isManifestEntry = (value: unknown): value is LevelManifestEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LevelManifestEntry>;
  return typeof entry.id === 'string'
    && Number.isInteger(entry.contentVersion)
    && Number.isInteger(entry.order)
    && typeof entry.title?.ru === 'string'
    && typeof entry.title?.en === 'string'
    && typeof entry.category === 'string'
    && Number.isInteger(entry.regionCount)
    && typeof entry.thumbnail === 'string'
    && typeof entry.levelData === 'string';
};

const isPaintLevel = (value: unknown): value is PaintLevel => {
  if (!value || typeof value !== 'object') return false;
  const level = value as Partial<PaintLevel>;
  return typeof level.id === 'string'
    && Number.isInteger(level.contentVersion)
    && [1, 2, 3, 4, 5].includes(Number(level.difficulty))
    && typeof level.viewBox === 'string'
    && Array.isArray(level.colors)
    && Array.isArray(level.regions)
    && level.regions.every((region) => Number.isInteger(region?.index));
};

export const loadLevelManifest = () => {
  manifestPromise ??= fetchJson('generated/levels-manifest.json').then((value) => {
    if (!Array.isArray(value) || !value.every(isManifestEntry)) throw new Error('Invalid levels manifest');
    return value;
  }).catch((error) => {
    manifestPromise = null;
    throw error;
  });
  return manifestPromise;
};

export const loadLevel = (entry: LevelManifestEntry) => {
  const cached = levelCache.get(entry.id);
  if (cached) return cached;
  const request = fetchJson(entry.levelData).then((value) => {
    if (!isPaintLevel(value) || value.id !== entry.id) throw new Error(`Invalid compiled level: ${entry.id}`);
    return value;
  }).catch((error) => {
    levelCache.delete(entry.id);
    throw error;
  });
  levelCache.set(entry.id, request);
  return request;
};
