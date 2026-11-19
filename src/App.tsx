import { useCallback, useEffect, useMemo, useState } from 'react';
import { SettingsModal } from './components/SettingsModal.tsx';
import { gameDescription } from './config/game.ts';
import { getLevelProgress } from './game/gameLogic.ts';
import type { Language, LevelManifestEntry, PaintLevel } from './game/types.ts';
import { useGameProgress } from './hooks/useGameProgress.ts';
import { dictionaries } from './i18n/index.ts';
import { GameScreen } from './screens/GameScreen.tsx';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';
import { pauseAudio, resumeAudio, setSoundEnabled, setMusicEnabled, setMusicScene, unlockAudio, playUISound } from './services/audio.ts';
import { loadLevel, loadLevelManifest } from './services/levels.ts';
import { setStickyBannerVisible, shouldShowStickyBanner } from './services/ads.ts';
import {
  getDetectedLanguage,
  initYandex,
  isPlayerAuthorized,
  isYandexAvailable,
  signalGameReady,
  startGameplay,
  stopGameplay,
  subscribeAccountSelectionEvents,
  subscribeGameplayEvents,
} from './services/yandexSDK.ts';

const levelIdFromHash = () => location.hash.match(/^#level\/([a-z0-9-]+)$/)?.[1] ?? null;
const homeUrl = () => `${location.pathname}${location.search}`;
const catalogUrl = () => `${location.pathname}${location.search}#catalog`;

export default function App() {
  const {
    save,
    initialize,
    saveLevelProgress,
    resetLevel,
    updateSettings,
    setLastPlayed,
    connectAccount,
    accountSelectionOpened,
    accountSelectionClosed,
    retryCloud,
    flush,
  } = useGameProgress();
  const [manifest, setManifest] = useState<readonly LevelManifestEntry[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [activeLevelId, setActiveLevelId] = useState<string | null>(levelIdFromHash);
  const [activeLevel, setActiveLevel] = useState<PaintLevel | null>(null);
  const [levelFailed, setLevelFailed] = useState(false);
  const [levelLoadAttempt, setLevelLoadAttempt] = useState(0);
  const [detectedLanguage, setDetectedLanguage] = useState<Language>(getDetectedLanguage);
  const [booting, setBooting] = useState(true);
  const [platformReady, setPlatformReady] = useState(false);
  const [yandexAvailable, setYandexAvailable] = useState(false);
  const [accountAuthorized, setAccountAuthorized] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [portalPaused, setPortalPaused] = useState(false);
  const [windowPaused, setWindowPaused] = useState(document.visibilityState !== 'visible');
  const [adPaused, setAdPaused] = useState(false);
  const [completionPaused, setCompletionPaused] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(() => location.hash === '#catalog');
  const [tutorialReplay, setTutorialReplay] = useState(false);

  const language: Language = save.settings.language === 'auto' ? detectedLanguage : save.settings.language;
  const t = dictionaries[language];
  const activeProgress = activeLevel ? getLevelProgress(activeLevel, save.levels[activeLevel.id]) : null;
  const tutorialShowing = Boolean(activeLevel && (!save.settings.tutorialCompleted || tutorialReplay));
  const interactionPaused = portalPaused || windowPaused || adPaused || settingsOpen || completionPaused || tutorialShowing;

  const acceptManifest = useCallback((levels: readonly LevelManifestEntry[]) => {
    setManifest(levels);
    setCatalogFailed(false);
    const hashLevelId = levelIdFromHash();
    if (hashLevelId && !levels.some(({ id }) => id === hashLevelId)) {
      history.replaceState({ quietColorsHome: true }, '', homeUrl());
      setActiveLevelId(null);
      setCatalogOpen(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const manifestRequest = loadLevelManifest();
    void (async () => {
      await initYandex();
      if (!alive) return;
      setDetectedLanguage(getDetectedLanguage());
      const available = isYandexAvailable();
      setYandexAvailable(available);
      setAccountAuthorized(available && await isPlayerAuthorized());
      await initialize();
      if (!alive) return;
      try {
        acceptManifest(await manifestRequest);
      } catch (error) {
        console.error('Failed to load level manifest.', error);
        setCatalogFailed(true);
      }
      if (!alive) return;
      setPlatformReady(true);
      setBooting(false);
    })();
    return () => { alive = false; };
  }, [acceptManifest, initialize]);

  const saveAccount = useCallback(async () => {
    const saved = await connectAccount();
    setAccountAuthorized(await isPlayerAuthorized());
    return saved;
  }, [connectAccount]);

  useEffect(() => {
    const interactive = !booting && (catalogFailed || !activeLevelId || Boolean(activeLevel) || levelFailed);
    if (!interactive) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(signalGameReady);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [activeLevel, activeLevelId, booting, catalogFailed, levelFailed]);

  useEffect(() => {
    let alive = true;
    setActiveLevel(null);
    setLevelFailed(false);
    if (!activeLevelId || !manifest.length) return () => { alive = false; };
    const entry = manifest.find(({ id }) => id === activeLevelId);
    if (!entry) return () => { alive = false; };
    void loadLevel(entry).then((level) => {
      if (alive) setActiveLevel(level);
    }).catch((error) => {
      console.error(`Failed to load level ${entry.id}.`, error);
      if (alive) setLevelFailed(true);
    });
    return () => { alive = false; };
  }, [activeLevelId, levelLoadAttempt, manifest]);

  useEffect(() => {
    const currentLevelId = levelIdFromHash();
    if (currentLevelId && !history.state?.quietColorsLevel) {
      const levelHash = location.hash;
      history.replaceState({ quietColorsHome: true }, '', homeUrl());
      history.pushState({ quietColorsLevel: currentLevelId }, '', levelHash);
    } else if (!currentLevelId && !history.state?.quietColorsHome) {
      history.replaceState({ quietColorsHome: true }, '', location.href);
    }
    const onPopState = () => {
      setActiveLevelId(levelIdFromHash());
      setCatalogOpen(location.hash === '#catalog');
      setActiveLevel(null);
      setSettingsOpen(false);
      setCompletionPaused(false);
      void flush();
    };
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, [flush]);

  useEffect(() => {
    if (!platformReady) return;
    const pause = () => {
      setPortalPaused(true);
      stopGameplay();
      pauseAudio();
      void flush();
    };
    const resume = () => {
      setPortalPaused(false);
      void retryCloud();
    };
    const browserPause = () => { setWindowPaused(true); stopGameplay(); pauseAudio(); void flush(); };
    const browserResume = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      setWindowPaused(false);
      void retryCloud();
    };
    const unsubscribeGameplay = subscribeGameplayEvents(pause, resume);
    const unsubscribeAccount = subscribeAccountSelectionEvents(
      accountSelectionOpened,
      () => { void accountSelectionClosed().finally(() => { void isPlayerAuthorized().then(setAccountAuthorized); }); },
    );
    const onVisibility = () => document.visibilityState === 'hidden' ? browserPause() : browserResume();
    document.addEventListener('visibilitychange', onVisibility);
    addEventListener('blur', browserPause);
    addEventListener('focus', browserResume);
    return () => {
      unsubscribeGameplay();
      unsubscribeAccount();
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('blur', browserPause);
      removeEventListener('focus', browserResume);
    };
  }, [accountSelectionClosed, accountSelectionOpened, flush, platformReady, retryCloud]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t.gameTitle;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', gameDescription[language]);
  }, [language, t.gameTitle]);

  useEffect(() => setSoundEnabled(save.settings.sound), [save.settings.sound]);
  useEffect(() => setMusicEnabled(save.settings.music !== false), [save.settings.music]);
  useEffect(() => setMusicScene(activeLevel ? 'gameplay' : 'menu'), [Boolean(activeLevel)]);

  useEffect(() => {
    if (platformReady) void setStickyBannerVisible(shouldShowStickyBanner(activeLevelId));
  }, [activeLevelId, platformReady]);

  useEffect(() => {
    const shouldPlay = Boolean(activeLevel && !interactionPaused && !activeProgress?.completed);
    shouldPlay ? startGameplay() : stopGameplay();
    if (portalPaused || windowPaused || adPaused || settingsOpen || tutorialShowing) pauseAudio();
    else resumeAudio();
    return () => stopGameplay();
  }, [activeLevel, activeProgress?.completed, adPaused, interactionPaused, portalPaused, windowPaused, settingsOpen, tutorialShowing]);

  const openLevel = useCallback((levelId: string) => {
    if (!manifest.some(({ id }) => id === levelId)) return;
    setCompletionPaused(false);
    setActiveLevel(null);
    setActiveLevelId(levelId);
    setLastPlayed(levelId);
    history.pushState({ quietColorsLevel: levelId }, '', `#level/${levelId}`);
  }, [manifest, setLastPlayed]);

  const goHome = useCallback(() => {
    setCatalogOpen(true);
    setTutorialReplay(false);
    setSettingsOpen(false);
    setCompletionPaused(false);
    void flush();
    history.replaceState({ quietColorsHome: true }, '', catalogUrl());
    setActiveLevelId(null);
    setActiveLevel(null);
  }, [flush]);

  const openNextLevel = useCallback(() => {
    if (!activeLevel) return;
    const index = manifest.findIndex(({ id }) => id === activeLevel.id);
    const next = manifest[index + 1];
    if (!next) return goHome();
    setCompletionPaused(false);
    setActiveLevel(null);
    setActiveLevelId(next.id);
    setLastPlayed(next.id);
    history.replaceState({ quietColorsLevel: next.id }, '', `#level/${next.id}`);
  }, [activeLevel, goHome, manifest, setLastPlayed]);

  const hasNext = useMemo(() => {
    if (!activeLevel) return false;
    return manifest.findIndex(({ id }) => id === activeLevel.id) < manifest.length - 1;
  }, [activeLevel, manifest]);

  const retryCatalog = useCallback(() => {
    setCatalogFailed(false);
    setBooting(true);
    void loadLevelManifest().then(acceptManifest).catch((error) => {
      console.error('Failed to reload level manifest.', error);
      setCatalogFailed(true);
    }).finally(() => setBooting(false));
  }, [acceptManifest]);

  if (booting) {
    return <div className="app-loader" role="status"><span className="loader-palette"><i /><i /><i /></span><p>{t.loading}</p></div>;
  }

  let content;
  if (catalogFailed) {
    content = <main className="app-error" role="alert"><h1>{t.catalogLoadError}</h1><button className="primary-button" onClick={retryCatalog}>{t.retry}</button></main>;
  } else if (activeLevelId && levelFailed) {
    content = <main className="app-error" role="alert"><h1>{t.levelLoadError}</h1><div className="error-actions"><button className="primary-button" onClick={() => setLevelLoadAttempt((value) => value + 1)}>{t.retry}</button><button className="secondary-button" onClick={goHome}>{t.backToCatalog}</button></div></main>;
  } else if (activeLevelId && !activeLevel) {
    content = <div className="app-loader" role="status"><span className="loader-palette"><i /><i /><i /></span><p>{t.loadingLevel}</p></div>;
  } else if (activeLevel) {
    content = (
      <GameScreen
        key={activeLevel.id}
        level={activeLevel}
        progress={save.levels[activeLevel.id]}
        language={language}
        t={t}
        paused={interactionPaused}
        hasNext={hasNext}
        onBack={goHome}
        onSettings={() => setSettingsOpen(true)}
        onSaveProgress={(progress, critical) => saveLevelProgress(activeLevel.id, progress, critical)}
        onNext={openNextLevel}
        onHome={goHome}
        onAdPause={() => setAdPaused(true)}
        onAdResume={() => setAdPaused(false)}
        onCompletionPause={setCompletionPaused}
        tutorialOpen={tutorialShowing && !settingsOpen && !adPaused}
        onTutorialFinish={() => { updateSettings({ tutorialCompleted: true }); setTutorialReplay(false); }}
      />
    );
  } else if (catalogOpen) {
    content = <HomeScreen levels={manifest} save={save} language={language} t={t} onOpen={openLevel} onSettings={() => setSettingsOpen(true)} onHome={() => setCatalogOpen(false)} />;
  } else {
    content = <StartScreen levels={manifest} save={save} language={language} t={t} onOpen={openLevel} onCatalog={() => setCatalogOpen(true)} onSettings={() => setSettingsOpen(true)} />;
  }

  return (
    <div
      className="app-shell"
      onClickCapture={(event) => { unlockAudio(); if ((event.target as Element).closest('button')) playUISound(); }}
      onKeyDownCapture={unlockAudio}
      onContextMenuCapture={(event) => event.preventDefault()}
    >
      {content}
      <SettingsModal
        open={settingsOpen}
        settings={save.settings}
        t={t}
        canReset={Boolean(activeLevel)}
        accountAvailable={yandexAvailable}
        accountAuthorized={accountAuthorized}
        onClose={() => setSettingsOpen(false)}
        onSoundChange={(sound) => updateSettings({ sound })}
        onMusicChange={(music) => updateSettings({ music })}
        onTutorial={() => { setSettingsOpen(false); setTutorialReplay(true); if (!activeLevel && manifest[0]) openLevel(manifest[0].id); }}
        onLanguageChange={(languageSetting) => updateSettings({ language: languageSetting })}
        onReset={() => activeLevel && resetLevel(activeLevel.id, activeLevel.contentVersion)}
        onSaveAccount={saveAccount}
      />
    </div>
  );
}
