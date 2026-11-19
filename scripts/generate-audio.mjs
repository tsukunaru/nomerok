// Original, replaceable ambient sketches; no third-party samples.
import { mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../public/audio/', import.meta.url);
const rate = 22050;
const seconds = 24;
const count = rate * seconds;

const addBell = (samples, start, frequency, amplitude, decay = 1.65) => {
  const first = Math.floor(start * rate);
  const length = Math.min(count - first, Math.ceil(decay * 5.5 * rate));
  for (let index = 0; index < length; index += 1) {
    const elapsed = index / rate;
    const envelope = Math.min(1, elapsed / .055) * Math.exp(-elapsed / decay);
    const tone = Math.sin(2 * Math.PI * frequency * elapsed)
      + .18 * Math.sin(2 * Math.PI * frequency * 2.01 * elapsed)
      + .055 * Math.sin(2 * Math.PI * frequency * 3.98 * elapsed);
    samples[first + index] += tone * envelope * amplitude;
  }
};

const addAir = (samples, initialSeed) => {
  let seed = initialSeed;
  let low = 0;
  let air = 0;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    low += (noise - low) * .065;
    air += (noise - low - air) * .28;
    const time = index / rate;
    samples[index] += air * (.0055 + .0015 * Math.sin(2 * Math.PI * time / 9.5));
  }
};

const writeTrack = async (name, notes) => {
  const samples = new Float64Array(count);
  addAir(samples, name === 'menu' ? 0x4e554d42 : 0x4441524b);
  notes.forEach(([start, frequency, amplitude = .12, decay = 1.65]) => {
    addBell(samples, start, frequency, amplitude, decay);
    addBell(samples, start + .38, frequency * 2, amplitude * .13, decay * .72);
  });

  const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0) || 1;
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index += 1) {
    const time = index / rate;
    const edgeFade = Math.min(1, time / .55, (seconds - time) / .8);
    data.writeInt16LE(Math.round(samples[index] / peak * edgeFade * 10500), 44 + index * 2);
  }
  await writeFile(new URL(`${name}.wav`, root), data);
  console.log(`${name}.wav: ${data.length} bytes`);
};

await mkdir(root, { recursive: true });
await writeTrack('menu', [
  [0.7, 293.66], [3.35, 440, .105], [6.15, 349.23], [9.15, 523.25, .09],
  [12.2, 440, .1], [15.1, 392, .105], [18.05, 329.63], [21.0, 293.66, .105, 1.35],
]);
await writeTrack('gameplay', [
  [0.8, 220, .105], [3.65, 293.66], [6.55, 349.23, .105], [9.45, 440, .09],
  [12.35, 261.63, .105], [15.2, 349.23], [18.1, 392, .095], [21.0, 293.66, .105, 1.35],
]);
