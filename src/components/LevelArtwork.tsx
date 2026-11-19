import { memo, useMemo, useRef, useCallback, type CSSProperties } from 'react';
import { gridDimensions, numberSizeForGrid } from '../game/camera.ts';
import { getUnpaintedColorMap } from '../game/colors.ts';
import { decodePaintedMask, hasPaintedIndex } from '../game/progressMask.ts';
import type { PaintLevel, PaintRegion } from '../game/types.ts';

const PixelCell = memo(({ region, painted, preview, fill, classes, label, onPaint }: {
  region: PaintRegion; painted: boolean; preview: boolean; fill?: string; classes: string;
  label?: string; onPaint?: (id: string) => void;
}) => <g className={classes} data-region-id={preview ? undefined : region.id} role={preview ? undefined : 'button'}
  tabIndex={preview || painted ? undefined : 0} aria-label={label}
  onKeyDown={preview ? undefined : (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPaint?.(region.id); }
  }}>
  <path className="region-shape" d={region.path} fill={fill} />
  {!preview && !painted && <text className="region-number" x={region.labelX} y={region.labelY}>{region.colorId}</text>}
</g>);

interface LevelArtworkProps {
  level: PaintLevel;
  paintedMask?: string;
  completed?: boolean;
  preview?: boolean;
  hintRegionId?: string | null;
  wrongRegionId?: string | null;
  rewardedRegionIds?: readonly string[];
  regionLabel?: (colorId: number) => string;
  onKeyboardPaint?: (regionId: string) => void;
}

export const LevelArtwork = ({
  level,
  paintedMask = '',
  completed = false,
  preview = false,
  hintRegionId,
  wrongRegionId,
  rewardedRegionIds = [],
  regionLabel,
  onKeyboardPaint,
}: LevelArtworkProps) => {
  const painted = decodePaintedMask(paintedMask);
  const grid = gridDimensions(level.viewBox);
  const rewarded = new Set(rewardedRegionIds);
  const colors = useMemo(() => new Map(level.colors.map((color) => [color.id, color.value])), [level]);
  const grays = useMemo(() => getUnpaintedColorMap(level.colors), [level]);
  const keyboardPaint = useRef(onKeyboardPaint);
  keyboardPaint.current = onKeyboardPaint;
  const activate = useCallback((id: string) => keyboardPaint.current?.(id), []);

  return (
    <svg
      className="level-artwork"
      viewBox={level.viewBox}
      role={preview ? undefined : 'group'}
      aria-hidden={preview || undefined}
      style={{ '--pixel-number-size': `${numberSizeForGrid(Math.max(grid.width, grid.height))}px` } as CSSProperties}
    >
      {level.regions.map((region) => {
        const isPainted = preview || completed || hasPaintedIndex(painted, region.index);
        const classes = [
          'paint-region',
          isPainted ? 'is-painted' : '',
          region.id === hintRegionId ? 'is-hint' : '',
          region.id === wrongRegionId ? 'is-wrong' : '',
          rewarded.has(region.id) ? 'is-rewarded' : '',
        ].filter(Boolean).join(' ');
        return (
          <PixelCell key={region.id} region={region} painted={isPainted} preview={preview}
            fill={isPainted ? colors.get(region.colorId) : grays.get(region.colorId)} classes={classes}
            label={preview ? undefined : regionLabel?.(region.colorId)} onPaint={activate} />
        );
      })}
    </svg>
  );
};
