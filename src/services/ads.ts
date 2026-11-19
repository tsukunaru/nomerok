import { pauseAudio } from './audio.ts';
import { isAdsAvailable, requestBannerVisible, requestFullscreenAd, requestRewardedVideo, stopGameplay } from './yandexSDK.ts';

let adActive = false;
let completionsSinceFullscreen = 0;
let lastFullscreenAt = 0;
let bannerTarget: boolean | null = null;
let bannerVisible: boolean | null = null;
let bannerRequest: Promise<boolean> | null = null;

export const FULLSCREEN_COMPLETIONS = 2;
export const FULLSCREEN_COOLDOWN_MS = 120_000;

export const canRequestFullscreen = (completions: number, lastShownAt: number, now = Date.now()) =>
  completions >= FULLSCREEN_COMPLETIONS && now - lastShownAt >= FULLSCREEN_COOLDOWN_MS;

const syncBanner = () => {
  if (bannerRequest) return bannerRequest;
  if (bannerTarget === null || bannerVisible === bannerTarget || adActive) return Promise.resolve(false);
  bannerRequest = (async () => {
    while (bannerTarget !== null && bannerVisible !== bannerTarget) {
      const target = bannerTarget;
      adActive = true;
      try {
        if (!await requestBannerVisible(target)) return false;
        bannerVisible = target;
      } finally {
        adActive = false;
      }
    }
    return true;
  })().finally(() => { bannerRequest = null; });
  return bannerRequest;
};

export const setStickyBannerVisible = (visible: boolean) => {
  bannerTarget = visible;
  return syncBanner();
};

export const shouldShowStickyBanner = (activeLevelId: string | null) => activeLevelId === null;

const withAdPause = async (request: (onOpen: () => void) => Promise<boolean>, onPause: () => void, onResume: () => void) => {
  if (adActive) return false;
  adActive = true;
  let paused = false;
  const pause = () => {
    if (paused) return;
    paused = true;
    onPause();
    stopGameplay();
    pauseAudio();
  };
  try {
    return await request(pause);
  } finally {
    adActive = false;
    if (paused) onResume();
    void syncBanner();
  }
};

export const rewardedAvailable = () => isAdsAvailable();

export const showRewardedAd = async (onPause: () => void, onResume: () => void, grantReward: () => void) => {
  if (!isAdsAvailable()) return false;
  await setStickyBannerVisible(false);
  return withAdPause((onOpen) => requestRewardedVideo(grantReward, onOpen), onPause, onResume);
};

export const recordLevelCompletion = () => { completionsSinceFullscreen += 1; };

export const maybeShowFullscreenAd = async (onPause: () => void, onResume: () => void) => {
  if (!isAdsAvailable() || !canRequestFullscreen(completionsSinceFullscreen, lastFullscreenAt)) return false;
  await setStickyBannerVisible(false);
  const shown = await withAdPause((onOpen) => requestFullscreenAd(onOpen), onPause, onResume);
  if (shown) {
    completionsSinceFullscreen = 0;
    lastFullscreenAt = Date.now();
  }
  return shown;
};
