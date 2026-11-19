let context: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let musicSourceScene: 'menu' | 'gameplay' | null = null;
const musicBuffers = new Map<'menu' | 'gameplay', AudioBuffer>();
const musicLoads = new Map<'menu' | 'gameplay', Promise<AudioBuffer | null>>();
let soundEnabled = true;
let musicEnabled = true;
let paused = false;
let unlocked = false;
let scene: 'menu' | 'gameplay' = 'menu';
let lastPaintAt = 0;

const allowed = () => !paused && document.visibilityState === 'visible' && document.hasFocus();

const getContext = () => {
  if (!context) {
    const Constructor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error('Web Audio is unavailable');
    context = new Constructor();
    sfxGain = context.createGain();
    musicGain = context.createGain();
    musicGain.gain.value = .16;
    sfxGain.connect(context.destination);
    musicGain.connect(context.destination);
  }
  return context;
};

const stopMusic = () => {
  if (!musicSource) return;
  try { musicSource.stop(); } catch { /* Already stopped. */ }
  musicSource.disconnect();
  musicSource = null;
  musicSourceScene = null;
};

const loadMusic = (nextScene: 'menu' | 'gameplay') => {
  const cached = musicBuffers.get(nextScene);
  if (cached) return Promise.resolve(cached);
  const pending = musicLoads.get(nextScene);
  if (pending) return pending;
  const request = (async () => {
    try {
      const response = await fetch(new URL(`audio/${nextScene}.wav`, document.baseURI));
      if (!response.ok) return null;
      const buffer = await getContext().decodeAudioData(await response.arrayBuffer());
      musicBuffers.set(nextScene, buffer);
      return buffer;
    } catch {
      return null;
    } finally {
      musicLoads.delete(nextScene);
    }
  })();
  musicLoads.set(nextScene, request);
  return request;
};

const syncMusic = () => {
  const targetScene = scene;
  if (!unlocked || !musicEnabled || !allowed()) {
    stopMusic();
    return;
  }
  if (musicSource && musicSourceScene === targetScene) return;
  stopMusic();
  void loadMusic(targetScene).then((buffer) => {
    if (!buffer || targetScene !== scene || !unlocked || !musicEnabled || !allowed()) return;
    try {
      const source = getContext().createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(musicGain!);
      source.onended = () => {
        if (musicSource === source) { musicSource = null; musicSourceScene = null; }
      };
      source.start();
      musicSource = source;
      musicSourceScene = targetScene;
    } catch { /* Audio must not block painting. */ }
  });
};

export const setMusicScene = (next: 'menu' | 'gameplay') => {
  if (scene !== next) { scene = next; stopMusic(); }
  syncMusic();
};

export const setMusicEnabled = (enabled: boolean) => { musicEnabled = enabled; syncMusic(); };

export const setSoundEnabled = (enabled: boolean) => {
  soundEnabled = enabled;
  if (sfxGain) sfxGain.gain.value = enabled ? 1 : 0;
};

export const unlockAudio = () => {
  unlocked = true;
  try { void getContext().resume().catch(() => undefined); } catch { /* Optional on unsupported hardware. */ }
  syncMusic();
};

export const pauseAudio = () => {
  paused = true;
  stopMusic();
  void context?.suspend().catch(() => undefined);
};

export const resumeAudio = () => {
  paused = false;
  if (unlocked && allowed()) void context?.resume().catch(() => undefined);
  syncMusic();
};

const tone = (frequency: number, delay: number, duration: number, volume = .022) => {
  if (!soundEnabled || !unlocked || !allowed()) return;
  try {
    const audio = getContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + delay;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(sfxGain!);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  } catch { /* Audio must not block painting. */ }
};

export const playUISound = () => tone(293.66, 0, .07, .012);
export const playSelectSound = () => tone(392, 0, .13, .018);
export const playHintSound = () => { tone(293.66, 0, .18, .018); tone(440, .13, .28, .016); };
export const playRewardSound = () => { tone(293.66, 0, .22, .018); tone(349.23, .16, .28, .017); tone(440, .32, .38, .016); };
export const playPaintSound = () => {
  if (Date.now() - lastPaintAt < 65) return;
  lastPaintAt = Date.now();
  tone(349.23, 0, .075, .012);
};
export const playColorCompleteSound = () => { tone(349.23, 0, .16, .018); tone(440, .12, .24, .016); };
export const playLevelCompleteSound = () => { tone(293.66, 0, .28, .019); tone(349.23, .16, .3, .018); tone(440, .34, .46, .017); };
