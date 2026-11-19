import type {
  CatalogStatus,
  CategorySlug,
  Language,
  LevelManifestEntry,
  LevelProgress,
} from './types.ts';
import { countPaintedBits } from './progressMask.ts';
import { calculateProgress } from './gameLogic.ts';
import type { SaveData } from './types.ts';

export const manifestProgress = (level: LevelManifestEntry, progress?: LevelProgress) => {
  if (!progress || level.regionCount < 1) return 0;
  const compatiblePrior = level.previousContent?.contentVersion === progress.contentVersion;
  if (progress.contentVersion !== level.contentVersion && !compatiblePrior) return 0;
  if (progress.completed) return 100;
  return calculateProgress(countPaintedBits(progress.paintedMask), compatiblePrior ? level.previousContent!.regionCount : level.regionCount);
};

export const findContinueLevel = (levels: readonly LevelManifestEntry[], save: SaveData) => {
  const unfinished = levels.filter((level) => {
    const progress = manifestProgress(level, save.levels[level.id]);
    return progress > 0 && progress < 100;
  });
  return unfinished.find(({ id }) => id === save.meta.lastPlayedLevelId) ??
    unfinished.sort((a, b) => save.levels[b.id].updatedAt - save.levels[a.id].updatedAt)[0];
};

export const filterCatalog = (
  levels: readonly LevelManifestEntry[],
  progressByLevel: Readonly<Record<string, LevelProgress>>,
  language: Language,
  search: string,
  category: CategorySlug | 'all',
  status: CatalogStatus,
) => {
  const query = search.trim().toLocaleLowerCase(language);
  return levels.filter((level) => {
    if (category !== 'all' && level.category !== category) return false;
    const progress = manifestProgress(level, progressByLevel[level.id]);
    if (status === 'new' && progress !== 0) return false;
    if (status === 'in-progress' && (progress === 0 || progress === 100)) return false;
    if (status === 'completed' && progress !== 100) return false;
    if (!query) return true;
    return [level.title[language], ...level.tags[language]]
      .some((value) => value.toLocaleLowerCase(language).includes(query));
  });
};
