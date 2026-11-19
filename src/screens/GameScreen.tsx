import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ColorPalette } from '../components/ColorPalette.tsx';
import { CompletionModal } from '../components/CompletionModal.tsx';
import { Icon } from '../components/Icon.tsx';
import { LevelArtwork } from '../components/LevelArtwork.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { ZoomControls } from '../components/ZoomControls.tsx';
import { Tutorial } from '../components/Tutorial.tsx';
import { gridDimensions, initialScaleForGrid } from '../game/camera.ts';
import {
  getLevelProgress,
  getLevelProgressPercent,
  getNextIncompleteColor,
  getRemainingRegionsForColor,
  filterPaintStroke,
  isColorCompleted,
  paintRegions,
  getRewardRegions,
  getRewardPixelCount,
} from '../game/gameLogic.ts';
import type { Language, LevelProgress, PaintLevel } from '../game/types.ts';
import { useZoomPan } from '../hooks/useZoomPan.ts';
import type { Translations } from '../i18n/types.ts';
import { formatText } from '../i18n/index.ts';
import { maybeShowFullscreenAd, recordLevelCompletion, rewardedAvailable, showRewardedAd } from '../services/ads.ts';
import { playColorCompleteSound, playLevelCompleteSound, playPaintSound, playSelectSound, playHintSound, playRewardSound } from '../services/audio.ts';

interface GameScreenProps {
  level: PaintLevel;
  progress?: LevelProgress;
  language: Language;
  t: Translations;
  paused: boolean;
  hasNext: boolean;
  onBack: () => void;
  onSettings: () => void;
  onSaveProgress: (progress: LevelProgress, critical?: boolean) => void;
  onNext: () => void;
  onHome: () => void;
  onAdPause: () => void;
  onAdResume: () => void;
  onCompletionPause: (paused: boolean) => void;
  tutorialOpen: boolean;
  onTutorialFinish: () => void;
}

export const GameScreen = ({
  level,
  progress,
  language,
  t,
  paused,
  hasNext,
  onBack,
  onSettings,
  onSaveProgress,
  onNext,
  onHome,
  onAdPause,
  onAdResume,
  onCompletionPause,
  tutorialOpen,
  onTutorialFinish,
}: GameScreenProps) => {
  const normalized = useMemo(() => getLevelProgress(level, progress), [level, progress]);
  const progressPercent = useMemo(() => getLevelProgressPercent(level, normalized), [level, normalized]);
  const grid = useMemo(() => gridDimensions(level.viewBox), [level.viewBox]);
  const initialScale = initialScaleForGrid(Math.max(grid.width, grid.height));
  const rewardText = formatText(t.magicHintText, { count: getRewardPixelCount(level.difficulty) });
  const liveProgress = useRef(normalized);
  const [selectedColorId, setSelectedColorId] = useState<number | null>(() => getNextIncompleteColor(level, normalized));
  const [hintRegionId, setHintRegionId] = useState<string | null>(null);
  const [wrongRegionId, setWrongRegionId] = useState<string | null>(null);
  const [rewardedRegionIds, setRewardedRegionIds] = useState<readonly string[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [toast, setToast] = useState('');
  const timers = useRef<number[]>([]);
  const mounted = useRef(true);
  const rewardBusy = useRef(false);

  const later = useCallback((callback: () => void, delay: number) => {
    const id = window.setTimeout(callback, delay);
    timers.current.push(id);
    return id;
  }, []);

  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    timers.current.forEach(window.clearTimeout);
    onCompletionPause(false);
  }; }, [onCompletionPause]);

  useEffect(() => {
    liveProgress.current = normalized;
  }, [normalized]);

  useEffect(() => {
    setSelectedColorId(getNextIncompleteColor(level, normalized));
    setHintRegionId(null);
    setWrongRegionId(null);
    setRewardedRegionIds([]);
    setCompletionOpen(false);
    setCelebrating(false);
  }, [level.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedColorId !== null && isColorCompleted(level, normalized, selectedColorId)) {
      setSelectedColorId(getNextIncompleteColor(level, normalized, selectedColorId));
    }
  }, [level, normalized, selectedColorId]);

  const completePainting = useCallback(() => {
    recordLevelCompletion();
    playLevelCompleteSound();
    setCelebrating(true);
    onCompletionPause(true);
    later(() => setCompletionOpen(true), 560);
  }, [later, onCompletionPause]);

  const applyPaint = useCallback((regionIds: readonly string[], colorId: number, reward = false) => {
    const current = liveProgress.current;
    const wasColorComplete = isColorCompleted(level, current, colorId);
    const next = paintRegions(level, current, regionIds);
    if (next.paintedMask === current.paintedMask && next.completed === current.completed) return;
    liveProgress.current = next;
    onSaveProgress(next, next.completed);
    if (reward) {
      setRewardedRegionIds(regionIds);
      later(() => setRewardedRegionIds([]), 720);
    }
    if (next.completed && !current.completed) {
      completePainting();
      return;
    }
    const colorComplete = !wasColorComplete && isColorCompleted(level, next, colorId);
    if (colorComplete) {
      playColorCompleteSound();
      setSelectedColorId(getNextIncompleteColor(level, next, colorId));
    } else {
      playPaintSound();
    }
  }, [completePainting, later, level, onSaveProgress]);

  const paintRegion = useCallback((regionId: string) => {
    const current = liveProgress.current;
    if (paused || current.completed || selectedColorId === null) return;
    const region = level.regions.find(({ id }) => id === regionId);
    if (!region || !filterPaintStroke(level, current, selectedColorId, [region.id]).length) {
      if (region?.colorId !== selectedColorId) {
        setWrongRegionId(region?.id ?? null);
        later(() => setWrongRegionId(null), 260);
      }
      return;
    }
    applyPaint([region.id], selectedColorId);
  }, [applyPaint, later, level, paused, selectedColorId]);

  const paintStroke = useCallback((regionIds: readonly string[]) => {
    const current = liveProgress.current;
    if (paused || current.completed || selectedColorId === null) return;
    const matching = filterPaintStroke(level, current, selectedColorId, regionIds);
    if (matching.length) applyPaint(matching, selectedColorId);
  }, [applyPaint, level, paused, selectedColorId]);

  const zoom = useZoomPan({
    initialScale,
    resetKey: level.id,
    viewBoxWidth: grid.width,
    viewBoxHeight: grid.height,
    disabled: paused || normalized.completed,
    onTap: paintRegion,
    onPaintStroke: paintStroke,
  });

  const showHint = () => {
    if (paused || selectedColorId === null) return;
    playHintSound();
    const target = getRemainingRegionsForColor(level, normalized, selectedColorId)[0];
    if (!target) return;
    zoom.focusPoint(target.labelX, target.labelY);
    later(() => {
      setHintRegionId(target.id);
      later(() => setHintRegionId(null), 1700);
    }, 240);
  };

  const showMagicHint = async () => {
    if (paused || rewardBusy.current || liveProgress.current.completed) return;
    rewardBusy.current = true;
    const rewarded = await showRewardedAd(onAdPause, onAdResume, () => {
      if (!mounted.current) return;
      const targets = getRewardRegions(level, liveProgress.current, selectedColorId);
      if (!targets[0]) return;
      zoom.focusPoint(targets[0].labelX, targets[0].labelY);
      applyPaint(targets.map(({ id }) => id), targets[0].colorId, true);
    });
    rewardBusy.current = false;
    if (!mounted.current) return;
    if (!rewarded) {
      setToast(t.rewardMissed);
      later(() => setToast(''), 2200);
      return;
    }
    later(playRewardSound, 120);
  };

  const leaveCompletion = async (destination: 'next' | 'home') => {
    setCompletionOpen(false);
    await maybeShowFullscreenAd(onAdPause, onAdResume);
    onCompletionPause(false);
    destination === 'next' ? onNext() : onHome();
  };

  const completedColorIds = level.colors
    .filter(({ id }) => isColorCompleted(level, normalized, id))
    .map(({ id }) => id);

  return (
    <main className={`game-screen ${paused ? 'is-paused' : ''}`}>
      <header className="game-header">
        <button className="icon-button" onClick={onBack} aria-label={t.back}><Icon name="arrow-left" /></button>
        <div className="game-heading">
          <h1>{level.title[language]}</h1>
          <ProgressBar value={progressPercent} label={t.progress} />
        </div>
        <button className="icon-button" onClick={onSettings} aria-label={t.settings}><Icon name="settings" /></button>
      </header>

      <div className="game-main">
        <section className="art-panel">
          <div className="art-toolbar">
            <div className="hint-controls">
              <button className="secondary-button compact" onClick={showHint} disabled={paused || normalized.completed || selectedColorId === null} title={t.hint}>
                <Icon name="bulb" size={21} /><span className="hint-label">{t.hint}</span>
              </button>
              <button
                className="reward-button"
                onClick={() => void showMagicHint()}
                disabled={paused || !rewardedAvailable() || normalized.completed || selectedColorId === null}
                title={rewardedAvailable() ? `${t.magicHint}. ${rewardText}` : t.adUnavailable}
              >
                <Icon name="video" size={21} /><span>{t.magicHint}<small>{rewardText}</small></span>
              </button>
            </div>
            <ZoomControls scale={zoom.scale} resetScale={initialScale} t={t} onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} onReset={zoom.reset} />
          </div>
          <div className="art-viewport" ref={zoom.viewportRef} onContextMenu={(event) => event.preventDefault()} {...zoom.pointerHandlers}>
            <div ref={zoom.transformRef} className={`art-transform ${zoom.transitioning ? 'is-camera-transition' : ''}`} style={zoom.transformStyle}>
              <LevelArtwork
                level={level}
                paintedMask={normalized.paintedMask}
                completed={normalized.completed}
                hintRegionId={hintRegionId}
                wrongRegionId={wrongRegionId}
                rewardedRegionIds={rewardedRegionIds}
                regionLabel={(colorId) => `${t.pixel}, ${t.color} ${colorId}`}
                onKeyboardPaint={paintRegion}
              />
            </div>
            {celebrating && <div className="confetti" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => (
                <i key={index} style={{
                  '--x': `${5 + index * 5}%`,
                  '--delay': `${index * .035}s`,
                  '--hue': index * 31,
                  '--drift': `${(index - 8) * 4}px`,
                  '--spin': `${index * 95}deg`,
                } as CSSProperties} />
              ))}
            </div>}
            {paused && <div className="pause-shade"><span>{t.paused}</span></div>}
          </div>
        </section>

        <aside className="game-dock">
          <ColorPalette
            colors={level.colors}
            selectedColorId={selectedColorId}
            completedColorIds={completedColorIds}
            t={t}
            onSelect={(id) => { if (!paused) { playSelectSound(); setSelectedColorId(id); } }}
          />
        </aside>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
      {tutorialOpen && <Tutorial t={t} onFinish={onTutorialFinish} />}
      <CompletionModal
        open={completionOpen}
        t={t}
        hasNext={hasNext}
        onNext={() => void leaveCompletion('next')}
        onHome={() => void leaveCompletion('home')}
      />
    </main>
  );
};
