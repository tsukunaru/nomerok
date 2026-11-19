import {
  addPaintedIndices,
  decodePaintedMask,
  hasPaintedIndex,
  legacyRegionIndex,
  paintedMaskFromIndices,
} from './progressMask.ts';
import type { LevelProgress, PaintLevel } from './types.ts';

const emptyProgress = (level: PaintLevel, updatedAt = 0): LevelProgress => ({
  paintedMask: '',
  completed: false,
  contentVersion: level.contentVersion,
  updatedAt,
});

const normalizeLevelProgress = (level: PaintLevel, progress?: LevelProgress): LevelProgress => {
  if (progress && progress.contentVersion !== level.contentVersion && level.previousContent?.contentVersion === progress.contentVersion) {
    if (progress.completed) return { ...progress, contentVersion: level.contentVersion, paintedMask: '' };
    const prior = level.previousContent;
    const [, , width, height] = level.viewBox.split(' ').map(Number);
    const bytes = decodePaintedMask(progress.paintedMask);
    const indices = level.regions.filter((region) => {
      const x = Math.floor(region.labelX / width * prior.columns);
      const y = Math.floor(region.labelY / height * prior.rows);
      return hasPaintedIndex(bytes, y * Math.max(30, prior.columns) + x) ||
        Boolean(region.legacyRegionId && hasPaintedIndex(bytes, legacyRegionIndex(region.legacyRegionId)));
    }).map(({ index }) => index);
    progress = { ...progress, contentVersion: level.contentVersion, paintedMask: paintedMaskFromIndices(indices) };
  }
  if (!progress || progress.contentVersion !== level.contentVersion) {
    return emptyProgress(level, progress?.updatedAt);
  }
  if (progress.completed) return { ...progress, paintedMask: '' };
  const saved = decodePaintedMask(progress.paintedMask);
  const paintedIndices = level.regions
    .filter(({ index, legacyRegionId }) =>
      hasPaintedIndex(saved, index) ||
      Boolean(legacyRegionId && hasPaintedIndex(saved, legacyRegionIndex(legacyRegionId))))
    .map(({ index }) => index);
  const completed = paintedIndices.length === level.regions.length;
  return {
    paintedMask: completed ? '' : paintedMaskFromIndices(paintedIndices),
    completed,
    contentVersion: level.contentVersion,
    updatedAt: progress.updatedAt,
  };
};

const normalizedCache = new WeakMap<LevelProgress, { level: PaintLevel; result: LevelProgress }>();
export const getLevelProgress = (level: PaintLevel, progress?: LevelProgress): LevelProgress => {
  const cached = progress && normalizedCache.get(progress);
  if (cached?.level === level) return cached.result;
  const result = normalizeLevelProgress(level, progress);
  if (progress) normalizedCache.set(progress, { level, result });
  normalizedCache.set(result, { level, result });
  return result;
};

const paintedRegionCount = (level: PaintLevel, progress?: LevelProgress) => {
  const normalized = getLevelProgress(level, progress);
  if (normalized.completed) return level.regions.length;
  const painted = decodePaintedMask(normalized.paintedMask);
  return level.regions.reduce((count, region) => count + Number(hasPaintedIndex(painted, region.index)), 0);
};

export const getLevelProgressPercent = (level: PaintLevel, progress?: LevelProgress) =>
  calculateProgress(paintedRegionCount(level, progress), level.regions.length);

export const getRemainingRegionsForColor = (
  level: PaintLevel,
  progress: LevelProgress | undefined,
  colorId: number,
) => {
  const normalized = getLevelProgress(level, progress);
  if (normalized.completed) return [];
  const painted = decodePaintedMask(normalized.paintedMask);
  return level.regions.filter((region) => region.colorId === colorId && !hasPaintedIndex(painted, region.index));
};

export const isColorCompleted = (
  level: PaintLevel,
  progress: LevelProgress | undefined,
  colorId: number,
) => getRemainingRegionsForColor(level, progress, colorId).length === 0;

export const getNextIncompleteColor = (
  level: PaintLevel,
  progress: LevelProgress | undefined,
  afterColorId?: number,
) => {
  const start = Math.max(0, level.colors.findIndex(({ id }) => id === afterColorId) + 1);
  const ordered = [...level.colors.slice(start), ...level.colors.slice(0, start)];
  return ordered.find(({ id }) => !isColorCompleted(level, progress, id))?.id ?? null;
};

export const isLevelCompleted = (level: PaintLevel, progress?: LevelProgress) =>
  getLevelProgress(level, progress).completed;

export const calculateProgress = (paintedRegions: number, totalRegions: number) =>
  totalRegions > 0 ? paintedRegions >= totalRegions ? 100 : Math.min(99, Math.max(paintedRegions > 0 ? 1 : 0, Math.round((paintedRegions / totalRegions) * 100))) : 0;

const rewardPixels = [10, 15, 25, 40, 60] as const;
export const getRewardPixelCount = (difficulty: PaintLevel['difficulty']) => rewardPixels[difficulty - 1];

export const getRewardRegions = (level: PaintLevel, progress: LevelProgress, selected: number | null) => {
  const normalized = getLevelProgress(level, progress);
  const color = selected !== null && !isColorCompleted(level, normalized, selected)
    ? selected : getNextIncompleteColor(level, normalized, selected ?? undefined);
  if (color === null) return [];
  const painted = decodePaintedMask(normalized.paintedMask);
  const remaining = level.regions.filter(({ index }) => !hasPaintedIndex(painted, index));
  const count = getRewardPixelCount(level.difficulty);
  if (normalized.completed) return [];
  return remaining.length <= count ? remaining : getRemainingRegionsForColor(level, normalized, color).slice(0, count);
};

export const filterPaintStroke = (
  level: PaintLevel,
  progress: LevelProgress | undefined,
  colorId: number,
  regionIds: readonly string[],
) => {
  const normalized = getLevelProgress(level, progress);
  if (normalized.completed) return [];
  const painted = decodePaintedMask(normalized.paintedMask);
  const candidates = new Set(regionIds);
  return level.regions
    .filter((region) => candidates.has(region.id) && region.colorId === colorId && !hasPaintedIndex(painted, region.index))
    .map(({ id }) => id);
};

export const paintRegions = (
  level: PaintLevel,
  progress: LevelProgress | undefined,
  regionIds: readonly string[],
  updatedAt = Date.now(),
): LevelProgress => {
  const normalized = getLevelProgress(level, progress);
  if (normalized.completed) return normalized;
  const selected = new Set(regionIds);
  const indices = level.regions.filter(({ id }) => selected.has(id)).map(({ index }) => index);
  const paintedMask = addPaintedIndices(normalized.paintedMask, indices);
  const next = {
    paintedMask,
    completed: false,
    contentVersion: level.contentVersion,
    updatedAt,
  };
  const completed = paintedRegionCount(level, next) === level.regions.length;
  return { ...next, paintedMask: completed ? '' : paintedMask, completed };
};
