import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { LazyThumbnail } from '../components/LazyThumbnail.tsx';
import { LevelCard } from '../components/LevelCard.tsx';
import { filterCatalog, findContinueLevel, manifestProgress } from '../game/catalog.ts';
import type {
  CatalogStatus,
  CategorySlug,
  Language,
  LevelManifestEntry,
  SaveData,
} from '../game/types.ts';
import { formatText } from '../i18n/index.ts';
import type { Translations } from '../i18n/types.ts';

const BATCH_SIZE = 32;

interface HomeScreenProps {
  levels: readonly LevelManifestEntry[];
  save: SaveData;
  language: Language;
  t: Translations;
  onOpen: (levelId: string) => void;
  onSettings: () => void;
  onHome: () => void;
}

export const HomeScreen = ({ levels, save, language, t, onOpen, onSettings, onHome }: HomeScreenProps) => {
  const homeRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState<CategorySlug | 'all'>('all');
  const [status, setStatus] = useState<CatalogStatus>('all');
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const categories = useMemo(
    () => [...new Set(levels.map((level) => level.category))],
    [levels],
  );
  const filtered = useMemo(
    () => filterCatalog(levels, save.levels, language, deferredSearch, category, status),
    [category, deferredSearch, language, levels, save.levels, status],
  );
  const visibleLevels = filtered.slice(0, visibleCount);
  const completedCount = levels.filter((level) => manifestProgress(level, save.levels[level.id]) === 100).length;
  const lastLevel = findContinueLevel(levels, save);
  const lastProgress = lastLevel ? manifestProgress(lastLevel, save.levels[lastLevel.id]) : 0;
  const canContinue = Boolean(lastLevel && lastProgress > 0 && lastProgress < 100);

  useEffect(() => setVisibleCount(BATCH_SIZE), [category, deferredSearch, language, status]);

  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    if (!('IntersectionObserver' in window)) {
      setVisibleCount(filtered.length);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount((count) => Math.min(count + BATCH_SIZE, filtered.length));
    }, { root: homeRef.current, rootMargin: '500px 0px' });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [filtered.length, visibleCount]);

  const statuses: readonly [CatalogStatus, string][] = [
    ['all', t.all],
    ['new', t.newLevels],
    ['in-progress', t.inProgress],
    ['completed', t.completed],
  ];

  return (
    <main className="home-screen" ref={homeRef}>
      <header className="home-header">
        <button className="icon-button" onClick={onHome} aria-label={t.home}><Icon name="arrow-left" /></button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><h1>{t.gameTitle}</h1><p>{t.subtitle}</p></div>
        </div>
        <button className="icon-button elevated" onClick={onSettings} aria-label={t.settings}><Icon name="settings" /></button>
      </header>

      <section className="collection-banner" aria-label={t.collection}>
        <div>
          <span>{t.collection}</span>
          <strong>{formatText(t.completedOf, { done: completedCount, total: levels.length })}</strong>
        </div>
        <div className="collection-meter" aria-hidden="true">
          <i style={{ width: `${levels.length ? (completedCount / levels.length) * 100 : 0}%` }} />
        </div>
      </section>

      {canContinue && lastLevel && (
        <button className="continue-card" onClick={() => onOpen(lastLevel.id)}>
          <LazyThumbnail
            className="continue-preview"
            path={lastLevel.thumbnail}
            alt={lastLevel.title[language]}
            fallback={t.imageUnavailable}
            eager
          />
          <span className="continue-copy"><small>{t.continueLevel}</small><strong>{lastLevel.title[language]}</strong><em>{lastProgress}%</em></span>
          <span className="continue-arrow"><Icon name="arrow-left" /></span>
        </button>
      )}

      <section className="catalog-tools" aria-label={t.categoriesLabel}>
        <label className="search-box">
          <Icon name="search" size={21} />
          <span className="visually-hidden">{t.searchPlaceholder}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchPlaceholder} type="search" />
        </label>
        <div className="filter-group">
          <span className="filter-label">{t.categoriesLabel}</span>
          <div className="filter-scroll">
            <button className={category === 'all' ? 'is-active' : ''} onClick={() => setCategory('all')} aria-pressed={category === 'all'}>{t.all}</button>
            {categories.map((value) => (
              <button className={category === value ? 'is-active' : ''} onClick={() => setCategory(value)} aria-pressed={category === value} key={value}>{t.categories[value]}</button>
            ))}
          </div>
        </div>
        <div className="filter-group status-filter">
          <span className="filter-label">{t.statusLabel}</span>
          <div className="filter-scroll">
            {statuses.map(([value, label]) => (
              <button className={status === value ? 'is-active' : ''} onClick={() => setStatus(value)} aria-pressed={status === value} key={value}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      {filtered.length ? (
        <>
          <section className="level-grid" aria-label={t.collection}>
            {visibleLevels.map((level) => (
              <LevelCard
                key={level.id}
                level={level}
                progress={save.levels[level.id]}
                language={language}
                t={t}
                onOpen={() => onOpen(level.id)}
              />
            ))}
          </section>
          {visibleCount < filtered.length && <div className="catalog-sentinel" ref={sentinelRef} aria-hidden="true" />}
        </>
      ) : (
        <section className="empty-state">
          <Icon name="search" size={32} />
          <h2>{t.noResultsTitle}</h2>
          <p>{t.noResultsText}</p>
        </section>
      )}
    </main>
  );
};
