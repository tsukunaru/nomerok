import type { LevelProgress, SaveData, SaveMeta, SaveSettings } from '../game/types.ts';
import {
  decodePaintedMask,
  encodePaintedBytes,
  indexFromPixelRegionId,
  paintedMaskFromIndices,
} from '../game/progressMask.ts';
import {
  getYandexStorage,
  isPlayerAuthorized,
  openAuthDialog,
  readCloudData,
  refreshPlayer,
  writeCloudData,
} from './yandexSDK.ts';

const STORAGE_KEY = 'quiet-colors-save-v1';
const CLOUD_KEY = 'quietColorsSave';
const CLOUD_DELAY = 3000;

export type CloudHydrationState = 'not-started' | 'loading' | 'success' | 'unavailable' | 'error';
export type CloudSaveReadResult =
  | { readonly status: 'success'; readonly save: SaveData | null }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error'; readonly error?: unknown };
export interface CloudSyncDependencies {
  readonly openAuth: () => Promise<boolean>;
  readonly refreshPlayer: () => Promise<boolean>;
  readonly isAuthorized: () => Promise<boolean>;
  readonly read: () => Promise<CloudSaveReadResult>;
  readonly write: (save: SaveData, critical: boolean) => Promise<boolean>;
}
export interface CloudSyncResult {
  readonly status: Exclude<CloudHydrationState, 'not-started' | 'loading'>;
  readonly save: SaveData;
  readonly written: boolean;
}

let yandexStorage: Awaited<ReturnType<typeof getYandexStorage>> = null;
let pendingCloudSave: SaveData | null = null;
let cloudHydrationState: CloudHydrationState = 'not-started';

export const createSaveDebouncer = (delay: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(action: () => void) {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        action();
      }, delay);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
};

const cloudDebouncer = createSaveDebouncer(CLOUD_DELAY);

export const createDefaultSave = (): SaveData => ({
  version: 3,
  levels: {},
  settings: { sound: true, tutorialCompleted: false, language: 'auto', updatedAt: 0 },
  meta: { updatedAt: 0 },
});

const finiteTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

const migrateLevelProgress = (value: unknown, sourceVersion: number): LevelProgress | null => {
  if (!value || typeof value !== 'object') return null;
  const progress = value as Record<string, unknown>;
  const completed = Boolean(progress.completed);
  const paintedMask = sourceVersion === 3 && typeof progress.paintedMask === 'string'
    ? encodePaintedBytes(decodePaintedMask(progress.paintedMask))
    : paintedMaskFromIndices(
      Array.isArray(progress.paintedRegionIds)
        ? progress.paintedRegionIds
          .filter((id): id is string => typeof id === 'string')
          .map(indexFromPixelRegionId)
          .filter((index) => index >= 0)
        : [],
    );
  return {
    paintedMask: completed ? '' : paintedMask,
    completed,
    contentVersion: sourceVersion === 3 && Number.isInteger(progress.contentVersion) && Number(progress.contentVersion) > 0
      ? Number(progress.contentVersion)
      : 1,
    updatedAt: finiteTime(progress.updatedAt),
  };
};

const migrateSettings = (value: unknown, fallbackUpdatedAt: number): SaveSettings => {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const language = settings.language;
  return {
    sound: settings.sound !== false,
    tutorialCompleted: settings.tutorialCompleted === true,
    language: language === 'ru' || language === 'en' ? language : 'auto',
    updatedAt: finiteTime(settings.updatedAt) || fallbackUpdatedAt,
  };
};

const migrateMeta = (raw: Record<string, unknown>, fallbackUpdatedAt: number): SaveMeta => {
  const source = raw.meta && typeof raw.meta === 'object' ? raw.meta as Record<string, unknown> : raw;
  const lastPlayedLevelId = source.lastPlayedLevelId;
  return {
    ...(typeof lastPlayedLevelId === 'string' ? { lastPlayedLevelId } : {}),
    updatedAt: finiteTime(source.updatedAt) || fallbackUpdatedAt,
  };
};

export const migrateSaveData = (input: unknown): SaveData | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) return null;
  const rootUpdatedAt = finiteTime(raw.updatedAt);
  const levels: Record<string, LevelProgress> = {};
  if (raw.levels && typeof raw.levels === 'object' && !Array.isArray(raw.levels)) {
    Object.entries(raw.levels as Record<string, unknown>).forEach(([levelId, value]) => {
      const progress = migrateLevelProgress(value, Number(raw.version));
      if (progress) levels[levelId] = progress;
    });
  }
  return {
    version: 3,
    levels,
    settings: migrateSettings(raw.settings, rootUpdatedAt),
    meta: migrateMeta(raw, rootUpdatedAt),
  };
};

const parseSave = (value: unknown) => {
  try {
    return migrateSaveData(typeof value === 'string' ? JSON.parse(value) : value);
  } catch {
    return null;
  }
};

export const readBrowserSave = () => {
  try {
    return parseSave(localStorage.getItem(STORAGE_KEY)) ?? createDefaultSave();
  } catch {
    return createDefaultSave();
  }
};

export const initializeYandexStorage = async () => {
  yandexStorage = await getYandexStorage();
  if (!yandexStorage) return null;
  try {
    return parseSave(await yandexStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

export const readCloudSave = async (): Promise<CloudSaveReadResult> => {
  const result = await readCloudData(CLOUD_KEY);
  if (result.status !== 'success') return result;
  if (result.value === null || result.value === undefined) return { status: 'success', save: null };
  const save = parseSave(result.value);
  return save
    ? { status: 'success', save }
    : { status: 'error', error: new Error('Cloud save is malformed') };
};

export const mergeSaveData = (...saves: (SaveData | null | undefined)[]): SaveData => {
  const candidates = saves.filter((save): save is SaveData => Boolean(save));
  if (!candidates.length) return createDefaultSave();
  const levels: Record<string, LevelProgress> = {};
  let settings: SaveSettings | undefined;
  let meta: SaveMeta | undefined;
  candidates.forEach((save) => {
    Object.entries(save.levels).forEach(([levelId, progress]) => {
      if (!levels[levelId] || progress.updatedAt > levels[levelId].updatedAt) levels[levelId] = progress;
    });
    if (!settings || save.settings.updatedAt > settings.updatedAt) settings = save.settings;
    if (!meta || save.meta.updatedAt > meta.updatedAt) meta = save.meta;
  });
  return { version: 3, levels, settings: settings!, meta: meta! };
};

export const writeLocalSave = (save: SaveData) => {
  const serialized = JSON.stringify(save);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Yandex Storage remains available when iframe localStorage is restricted.
  }
  try {
    if (yandexStorage) void Promise.resolve(yandexStorage.setItem(STORAGE_KEY, serialized)).catch(() => undefined);
  } catch {
    // The browser copy above is already safe.
  }
};

export const getCloudHydrationState = () => cloudHydrationState;

export const pauseCloudSynchronization = () => {
  cloudHydrationState = 'loading';
  cloudDebouncer.cancel();
};

export const scheduleCloudSave = (save: SaveData) => {
  pendingCloudSave = save;
  cloudDebouncer.cancel();
  if (cloudHydrationState !== 'success') return;
  cloudDebouncer.schedule(() => { void flushCloudSave(false); });
};

export const flushCloudSave = async (critical = true, save?: SaveData) => {
  cloudDebouncer.cancel();
  const value = save ?? pendingCloudSave;
  if (!value || cloudHydrationState !== 'success') return false;
  const saved = await writeCloudData(CLOUD_KEY, value, critical);
  if (saved && pendingCloudSave === value) pendingCloudSave = null;
  return saved;
};

const defaultDependencies: CloudSyncDependencies = {
  openAuth: openAuthDialog,
  refreshPlayer,
  isAuthorized: isPlayerAuthorized,
  read: readCloudSave,
  write: (save, critical) => writeCloudData(CLOUD_KEY, save, critical),
};

const finishSuccessfulRead = async (
  current: SaveData,
  cloudSave: SaveData | null,
  apply: (save: SaveData) => void,
  dependencies: CloudSyncDependencies,
): Promise<CloudSyncResult> => {
  const merged = mergeSaveData(current, cloudSave);
  apply(merged);
  cloudHydrationState = 'success';
  pendingCloudSave = merged;
  const written = await dependencies.write(merged, true);
  if (written && pendingCloudSave === merged) pendingCloudSave = null;
  return { status: 'success', save: merged, written };
};

const failedSync = (status: 'unavailable' | 'error', current: SaveData): CloudSyncResult => {
  cloudHydrationState = status;
  pendingCloudSave = current;
  return { status, save: current, written: false };
};

export const hydrateCloudSave = async (
  current: SaveData,
  apply: (save: SaveData) => void,
  dependencies: CloudSyncDependencies = defaultDependencies,
): Promise<CloudSyncResult> => {
  pauseCloudSynchronization();
  const result = await dependencies.read();
  if (result.status !== 'success') return failedSync(result.status, current);
  return finishSuccessfulRead(current, result.save, apply, dependencies);
};

export const synchronizeAccount = async (
  current: SaveData,
  apply: (save: SaveData) => void,
  requestAuth: boolean,
  dependencies: CloudSyncDependencies = defaultDependencies,
): Promise<CloudSyncResult> => {
  pauseCloudSynchronization();
  if (!await dependencies.refreshPlayer()) return failedSync('unavailable', current);
  const authorized = await dependencies.isAuthorized();
  if (requestAuth && !authorized) {
    if (!await dependencies.openAuth()) return failedSync('unavailable', current);
    if (!await dependencies.refreshPlayer() || !await dependencies.isAuthorized()) return failedSync('unavailable', current);
  } else if (!authorized) return failedSync('unavailable', current);
  const result = await dependencies.read();
  if (result.status !== 'success') return failedSync(result.status, current);
  return finishSuccessfulRead(current, result.save, apply, dependencies);
};
