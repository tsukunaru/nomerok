import { findContinueLevel, manifestProgress } from '../game/catalog.ts';
import type { Language, LevelManifestEntry, SaveData } from '../game/types.ts';
import type { Translations } from '../i18n/types.ts';
import { formatText } from '../i18n/index.ts';
import { assetUrl } from '../services/levels.ts';

export const StartScreen = ({ levels, save, language, t, onOpen, onCatalog, onSettings }: {
  levels: readonly LevelManifestEntry[]; save: SaveData; language: Language; t: Translations;
  onOpen: (id: string) => void; onCatalog: () => void; onSettings: () => void;
}) => {
  const unfinished = findContinueLevel(levels, save);
  const next = levels.find((level) => manifestProgress(level, save.levels[level.id]) < 100);
  const done = levels.filter((level) => manifestProgress(level, save.levels[level.id]) === 100).length;
  return <main className="start-screen">
    <section className="start-card">
      <div className="start-illustration" aria-hidden="true">
        <img className="start-preview" src={assetUrl('art/menu-castle.png')} alt="" width={640} height={640} />
      </div>
      <div className="start-copy">
        <h1>{t.gameTitle}</h1><p>{language === 'ru' ? 'Уютная пиксельная раскраска по номерам' : 'A relaxing pixel color-by-number game'}</p>
        <div className="start-actions">
          <button className="primary-button" onClick={() => next ? onOpen(next.id) : onCatalog()}>{t.play}</button>
          {unfinished && <button className="secondary-button start-continue" onClick={() => onOpen(unfinished.id)}>{t.continue} · {unfinished.title[language]}</button>}
          <button className="secondary-button" onClick={onCatalog}>{t.levelSelect}</button>
          <button className="secondary-button" onClick={onSettings}>{t.settings}</button>
        </div>
        <p className="start-progress">{formatText(t.completedOf, { done, total: levels.length })}</p>
      </div>
    </section>
  </main>;
};
