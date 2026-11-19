import type { Language } from '../game/types.ts';

interface YandexStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

interface YandexPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
  isAuthorized(): boolean | Promise<boolean>;
}

interface AdCallbacks {
  onOpen?: () => void;
  onClose?: (wasShown?: boolean) => void;
  onError?: (error?: unknown) => void;
  onRewarded?: () => void;
}

type DeviceInfo = {
  type?: 'desktop' | 'mobile' | 'tablet' | 'tv';
  isDesktop?(): boolean;
  isMobile?(): boolean;
  isTablet?(): boolean;
  isTV?(): boolean;
};

interface YandexSdk {
  environment?: { i18n?: { lang?: string } };
  features?: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  adv?: {
    showRewardedVideo(options: { callbacks: AdCallbacks }): void;
    showFullscreenAdv(options: { callbacks: AdCallbacks }): void;
    getBannerAdvStatus?(): Promise<{ stickyAdvIsShowing: boolean; reason?: string }>;
    showBannerAdv?(): Promise<{ stickyAdvIsShowing: boolean; reason?: string }>;
    hideBannerAdv?(): Promise<{ stickyAdvIsShowing: boolean }>;
  };
  deviceInfo?: DeviceInfo | (() => DeviceInfo);
  auth?: { openAuthDialog(): Promise<void> };
  EVENTS?: {
    ACCOUNT_SELECTION_DIALOG_OPENED?: string;
    ACCOUNT_SELECTION_DIALOG_CLOSED?: string;
  };
  getPlayer?(options?: { scopes?: boolean }): Promise<YandexPlayer>;
  getStorage?(): Promise<YandexStorage>;
  on?(event: string, handler: () => void): void;
  off?(event: string, handler: () => void): void;
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YandexSdk> };
  }
}

export type CloudDataReadResult =
  | { readonly status: 'success'; readonly value: unknown }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error'; readonly error: unknown };

let sdk: YandexSdk | null = null;
let player: YandexPlayer | null = null;
let initPromise: Promise<boolean> | null = null;
let readySent = false;
let gameplayActive = false;
const cloudDataCache = new Map<string, string>();
const deviceClasses = ['desktop', 'mobile', 'tablet', 'tv'].map((type) => `yandex-device-${type}`);

const applyDeviceClass = (type: 'desktop' | 'mobile' | 'tablet' | 'tv') => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.remove(...deviceClasses);
  document.documentElement.classList.add(`yandex-device-${type}`);
};

const detectDeviceType = (): 'desktop' | 'mobile' | 'tablet' | 'tv' => {
  try {
    const source = sdk?.deviceInfo;
    const info = typeof source === 'function' ? source() : source;
    if (info?.type && ['desktop', 'mobile', 'tablet', 'tv'].includes(info.type)) return info.type;
    if (info?.isDesktop?.()) return 'desktop';
    if (info?.isMobile?.()) return 'mobile';
    if (info?.isTablet?.()) return 'tablet';
    if (info?.isTV?.()) return 'tv';
  } catch (error) {
    console.warn('Yandex deviceInfo failed; browser fallback is active.', error);
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'mobile' : 'desktop';
};

const withTimeout = async <T>(promise: Promise<T>, milliseconds = 6000): Promise<T> => {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Yandex SDK timeout')), milliseconds);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
};

export const refreshPlayer = async () => {
  player = null;
  cloudDataCache.clear();
  if (!sdk?.getPlayer) return false;
  try {
    player = await withTimeout(sdk.getPlayer());
    return true;
  } catch {
    return false;
  }
};

export const initYandex = () => {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!window.YaGames?.init) {
      applyDeviceClass(detectDeviceType());
      return false;
    }
    try {
      sdk = await withTimeout(window.YaGames.init(), 8000);
      applyDeviceClass(detectDeviceType());
      await refreshPlayer();
      return true;
    } catch (error) {
      console.warn('Yandex Games SDK is unavailable; local mode is active.', error);
      sdk = null;
      player = null;
      applyDeviceClass(detectDeviceType());
      return false;
    }
  })();
  return initPromise;
};

export const isYandexAvailable = () => sdk !== null;
export const isAdsAvailable = () => Boolean(sdk?.adv?.showRewardedVideo);

export const getDetectedLanguage = (): Language => {
  const sdkLanguage = sdk?.environment?.i18n?.lang?.toLowerCase();
  if (sdkLanguage) return sdkLanguage === 'ru' ? 'ru' : 'en';
  const browserLanguage = navigator.language?.toLowerCase();
  if (!browserLanguage) return 'ru';
  return browserLanguage.startsWith('ru') ? 'ru' : 'en';
};

export const signalGameReady = () => {
  if (readySent) return;
  readySent = true;
  try {
    sdk?.features?.LoadingAPI?.ready();
  } catch (error) {
    console.warn('LoadingAPI.ready failed.', error);
  }
};

export const startGameplay = () => {
  if (gameplayActive) return;
  gameplayActive = true;
  try {
    sdk?.features?.GameplayAPI?.start();
  } catch (error) {
    console.warn('GameplayAPI.start failed.', error);
  }
};

export const stopGameplay = () => {
  if (!gameplayActive) return;
  gameplayActive = false;
  try {
    sdk?.features?.GameplayAPI?.stop();
  } catch (error) {
    console.warn('GameplayAPI.stop failed.', error);
  }
};

export const subscribeGameplayEvents = (onPause: () => void, onResume: () => void) => {
  sdk?.on?.('game_api_pause', onPause);
  sdk?.on?.('game_api_resume', onResume);
  return () => {
    sdk?.off?.('game_api_pause', onPause);
    sdk?.off?.('game_api_resume', onResume);
  };
};

export const subscribeAccountSelectionEvents = (onOpened: () => void, onClosed: () => void) => {
  const openedEvent = sdk?.EVENTS?.ACCOUNT_SELECTION_DIALOG_OPENED;
  const closedEvent = sdk?.EVENTS?.ACCOUNT_SELECTION_DIALOG_CLOSED;
  if (openedEvent) sdk?.on?.(openedEvent, onOpened);
  if (closedEvent) sdk?.on?.(closedEvent, onClosed);
  return () => {
    if (openedEvent) sdk?.off?.(openedEvent, onOpened);
    if (closedEvent) sdk?.off?.(closedEvent, onClosed);
  };
};

export const getYandexStorage = async () => {
  try {
    return sdk?.getStorage ? await withTimeout(sdk.getStorage()) : null;
  } catch {
    return null;
  }
};

export const isPlayerAuthorized = async () => {
  if (!player || typeof player.isAuthorized !== 'function') return false;
  try {
    return Boolean(await Promise.resolve(player.isAuthorized()));
  } catch {
    return false;
  }
};

export const readCloudData = async (key: string): Promise<CloudDataReadResult> => {
  if (!player) return { status: 'unavailable' };
  try {
    const data = await withTimeout(player.getData([key]));
    const value = data?.[key] ?? null;
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) cloudDataCache.set(key, serialized);
    return { status: 'success', value };
  } catch (error) {
    return { status: 'error', error };
  }
};

export const writeCloudData = async (key: string, value: unknown, flush = false) => {
  if (!player) return false;
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined && cloudDataCache.get(key) === serialized) return true;
    await withTimeout(player.setData({ [key]: value }, flush));
    if (serialized !== undefined) cloudDataCache.set(key, serialized);
    return true;
  } catch {
    return false;
  }
};

export const openAuthDialog = async () => {
  if (await isPlayerAuthorized()) return true;
  if (!sdk?.auth?.openAuthDialog) return false;
  try {
    await sdk.auth.openAuthDialog();
    return true;
  } catch {
    return false;
  }
};

export const requestRewardedVideo = (
  grantReward: () => void = () => undefined,
  onOpen: () => void = () => undefined,
) => new Promise<boolean>((resolve) => {
  if (!sdk?.adv?.showRewardedVideo) return resolve(false);
  let rewarded = false;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    resolve(rewarded);
  };
  const timeout = window.setTimeout(finish, 180_000);
  try {
    sdk.adv.showRewardedVideo({
      callbacks: {
        onOpen,
        onRewarded: () => {
          if (settled || rewarded) return;
          rewarded = true;
          grantReward();
        },
        onClose: finish,
        onError: finish,
      },
    });
  } catch {
    finish();
  }
});

export const requestFullscreenAd = (onOpen: () => void = () => undefined) => new Promise<boolean>((resolve) => {
  if (!sdk?.adv?.showFullscreenAdv) return resolve(false);
  let settled = false;
  const finish = (shown = false) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    resolve(shown);
  };
  const timeout = window.setTimeout(() => finish(false), 180_000);
  try {
    sdk.adv.showFullscreenAdv({
      callbacks: {
        onOpen,
        onClose: (wasShown) => finish(Boolean(wasShown)),
        onError: () => finish(false),
      },
    });
  } catch {
    finish(false);
  }
});

export const requestBannerVisible = async (visible: boolean) => {
  const adv = sdk?.adv;
  const request = visible ? adv?.showBannerAdv : adv?.hideBannerAdv;
  if (!request) return false;
  try {
    const status = await adv?.getBannerAdvStatus?.();
    if (status?.stickyAdvIsShowing === visible) return true;
    return (await request.call(adv)).stickyAdvIsShowing === visible;
  } catch (error) {
    console.warn(`Sticky banner ${visible ? 'show' : 'hide'} failed.`, error);
    return false;
  }
};
