let context: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let soundEnabled = true;
let paused = false;
let unlocked = false;
let lastPaintAt = 0;

const allowed = () => !paused && document.visibilityState === 'visible' && document.hasFocus();

const getContext = () => {
  if (!context) {
    const Constructor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error('Web Audio is unavailable');
    context = new Constructor();
    sfxGain = context.createGain();
    sfxGain.connect(context.destination);
  }
  return context;
};

export const setSoundEnabled = (enabled: boolean) => {
  soundEnabled = enabled;
  if (sfxGain) sfxGain.gain.value = enabled ? 1 : 0;
};

export const unlockAudio = () => {
  unlocked = true;
  try { void getContext().resume().catch(() => undefined); } catch { /* Optional on unsupported hardware. */ }
};

export const pauseAudio = () => {
  paused = true;
  void context?.suspend().catch(() => undefined);
};

export const resumeAudio = () => {
  paused = false;
  if (unlocked && allowed()) void context?.resume().catch(() => undefined);
};

const tone = (frequency: number, delay: number, duration: number, volume = .022, endFrequency = frequency) => {
  if (!soundEnabled || !unlocked || !allowed()) return;
  try {
    const audio = getContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + delay;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
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
export const playSelectSound = () => tone(540, 0, .098, .026, 360);
export const playHintSound = () => { tone(293.66, 0, .18, .018); tone(440, .13, .28, .016); };
export const playRewardSound = () => { tone(293.66, 0, .22, .018); tone(349.23, .16, .28, .017); tone(440, .32, .38, .016); };
export const playPaintSound = () => {
  if (Date.now() - lastPaintAt < 65) return;
  lastPaintAt = Date.now();
  tone(349.23, 0, .075, .012);
};
export const playColorCompleteSound = () => { tone(349.23, 0, .16, .018); tone(440, .12, .24, .016); };
export const playLevelCompleteSound = () => { tone(293.66, 0, .28, .019); tone(349.23, .16, .3, .018); tone(440, .34, .46, .017); };
