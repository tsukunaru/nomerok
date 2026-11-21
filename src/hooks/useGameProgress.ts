import { useCallback, useRef, useState } from 'react';
import type { LanguageSetting, LevelProgress, SaveData } from '../game/types.ts';
import {
  flushCloudSave,
  getCloudHydrationState,
  hydrateCloudSave,
  initializeYandexStorage,
  mergeSaveData,
  pauseCloudSynchronization,
  readBrowserSave,
  scheduleCloudSave,
  synchronizeAccount,
  writeLocalSave,
} from '../services/storage.ts';

export const useGameProgress = () => {
  const [save, setSave] = useState<SaveData>(readBrowserSave);
  const saveRef = useRef(save);
  const initializePromise = useRef<Promise<SaveData> | null>(null);
  const syncPromise = useRef<Promise<boolean> | null>(null);

  const apply = useCallback((next: SaveData) => {
    saveRef.current = next;
    setSave(next);
    writeLocalSave(next);
  }, []);

  const commit = useCallback((update: (current: SaveData) => SaveData) => {
    setSave((current) => {
      const next = update(current);
      saveRef.current = next;
      writeLocalSave(next);
      scheduleCloudSave(next);
      return next;
    });
  }, []);

  const initialize = useCallback(() => {
    initializePromise.current ??= (async () => {
      const storageSave = await initializeYandexStorage();
      const localMerged = mergeSaveData(saveRef.current, storageSave);
      apply(localMerged);
      const result = await hydrateCloudSave(localMerged, apply);
      return result.save;
    })();
    return initializePromise.current;
  }, [apply]);

  const saveLevelProgress = useCallback((levelId: string, progress: LevelProgress, critical = false) => {
    const now = Date.now();
    const compactProgress = progress.completed ? { ...progress, paintedMask: '' } : progress;
    commit((current) => ({
      ...current,
      levels: { ...current.levels, [levelId]: compactProgress },
      meta: { lastPlayedLevelId: levelId, updatedAt: now },
    }));
    if (critical) setTimeout(() => { void flushCloudSave(true, saveRef.current); }, 0);
  }, [commit]);

  const resetLevel = useCallback((levelId: string, contentVersion: number) => {
    const now = Date.now();
    commit((current) => ({
      ...current,
      levels: {
        ...current.levels,
        [levelId]: { paintedMask: '', completed: false, contentVersion, updatedAt: now },
      },
      meta: { lastPlayedLevelId: levelId, updatedAt: now },
    }));
  }, [commit]);

  const updateSettings = useCallback((settings: { sound?: boolean; tutorialCompleted?: boolean; language?: LanguageSetting }) => {
    commit((current) => ({
      ...current,
      settings: { ...current.settings, ...settings, updatedAt: Date.now() },
    }));
  }, [commit]);

  const setLastPlayed = useCallback((levelId: string) => {
    commit((current) => ({
      ...current,
      meta: { lastPlayedLevelId: levelId, updatedAt: Date.now() },
    }));
  }, [commit]);

  const runAccountSync = useCallback((requestAuth: boolean) => {
    if (syncPromise.current) return syncPromise.current;
    syncPromise.current = synchronizeAccount(saveRef.current, apply, requestAuth)
      .then((result) => result.status === 'success' && result.written)
      .finally(() => { syncPromise.current = null; });
    return syncPromise.current;
  }, [apply]);

  const accountSelectionOpened = useCallback(() => {
    pauseCloudSynchronization();
    writeLocalSave(saveRef.current);
  }, []);

  const accountSelectionClosed = useCallback(() => runAccountSync(false), [runAccountSync]);

  const retryCloud = useCallback(async () => {
    if (getCloudHydrationState() !== 'error' || syncPromise.current) return false;
    syncPromise.current = hydrateCloudSave(saveRef.current, apply)
      .then((result) => result.status === 'success')
      .finally(() => { syncPromise.current = null; });
    return syncPromise.current;
  }, [apply]);

  const flush = useCallback(() => flushCloudSave(true, saveRef.current), []);

  return {
    save,
    initialize,
    saveLevelProgress,
    resetLevel,
    updateSettings,
    setLastPlayed,
    connectAccount: () => runAccountSync(true),
    accountSelectionOpened,
    accountSelectionClosed,
    retryCloud,
    flush,
  };
};
