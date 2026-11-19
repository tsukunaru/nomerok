import { manifestProgress } from '../game/catalog.ts';
import type { Language, LevelManifestEntry, LevelProgress } from '../game/types.ts';
import type { Translations } from '../i18n/types.ts';
import { Icon } from './Icon.tsx';
import { LazyThumbnail } from './LazyThumbnail.tsx';
import { ProgressBar } from './ProgressBar.tsx';

interface LevelCardProps {
  level: LevelManifestEntry;
  progress?: LevelProgress;
  language: Language;
  t: Translations;
  onOpen: () => void;
}

export const LevelCard = ({ level, progress, language, t, onOpen }: LevelCardProps) => {
  const value = manifestProgress(level, progress);
  const completed = value === 100;
  const status = completed ? t.done : value > 0 ? t.continue : t.start;

  return (
    <button className={`level-card ${completed ? 'is-complete' : ''}`} onClick={onOpen} aria-label={`${level.title[language]}. ${status}`}>
      <LazyThumbnail
        className="level-preview"
        path={level.thumbnail}
        alt={level.title[language]}
        fallback={t.imageUnavailable}
      />
      {completed && <span className="complete-badge"><Icon name="check" size={17} /></span>}
      <span className="level-card-copy">
        <span className="level-card-title">{level.title[language]}</span>
        <span className="level-details">{level.order} · {t.difficulty[level.difficulty - 1]}{level.gridSize && ` · ${level.gridSize.columns}×${level.gridSize.rows}`} · {t.palette}: {level.colorCount}</span>
        <ProgressBar value={value} label={t.progress} />
        <span className="level-status">{status}{completed && <Icon name="check" size={15} />}</span>
      </span>
    </button>
  );
};
