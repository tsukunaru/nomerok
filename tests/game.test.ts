import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  cameraOffsetForPoint,
  gridDimensions,
  initialScaleForGrid,
  numberSizeForGrid,
} from '../src/game/camera.ts';
import { filterCatalog, manifestProgress, findContinueLevel } from '../src/game/catalog.ts';
import { getUnpaintedColorMap } from '../src/game/colors.ts';
import {
  filterPaintStroke,
  getLevelProgress,
  getLevelProgressPercent,
  getNextIncompleteColor,
  getRemainingRegionsForColor,
  isColorCompleted,
  paintRegions,
  getRewardRegions,
  getRewardPixelCount,
} from '../src/game/gameLogic.ts';
import {
  countPaintedBits,
  decodePaintedMask,
  hasPaintedIndex,
  legacyRegionIndex,
  paintedMaskFromIndices,
  pixelIndex,
} from '../src/game/progressMask.ts';
import type { PaintLevel, SaveData } from '../src/game/types.ts';
import {
  createDefaultSave,
  createSaveDebouncer,
  hydrateCloudSave,
  mergeSaveData,
  migrateSaveData,
  synchronizeAccount,
  type CloudSyncDependencies,
} from '../src/services/storage.ts';
import {
  buildLevels,
  compileLevelSources,
  makeCatalogFixture,
  validateLevelDirectory,
  validateLevels,
} from '../scripts/levels.mjs';
import {
  classifyYandexSize,
  YANDEX_INTERNAL_LIMIT_BYTES,
} from '../scripts/check-yandex-size.mjs';
import {
  analyzePixelLevel,
  createImportFingerprint,
  importImages,
  makeLevelFiles,
  pixelateImageBuffer,
  validateImportConfig,
  gridForOrder,
} from '../scripts/import-images.mjs';
import { validateEntries } from '../scripts/package-yandex.mjs';
import { levelComplexity } from '../scripts/level-complexity.mjs';
import { checkDesktopFrames } from '../scripts/check-desktop-frame.mjs';
import {
  canRequestFullscreen,
  maybeShowFullscreenAd,
  recordLevelCompletion,
  setStickyBannerVisible,
  shouldShowStickyBanner,
  showRewardedAd,
} from '../src/services/ads.ts';

const projectRoot = resolve(import.meta.dirname, '..');
const contentRoot = resolve(projectRoot, 'content/levels');
const generatedManifestPath = resolve(projectRoot, 'public/generated/levels-manifest.json');
const templateRoot = resolve(projectRoot, 'content/templates/example-level');
const levelsPromise = validateLevels(contentRoot);

const loadTemplate = async () => ({
  metadata: await readFile(resolve(templateRoot, 'level.json'), 'utf8'),
  artwork: await readFile(resolve(templateRoot, 'artwork.svg'), 'utf8'),
});

const withLevel = (
  base: SaveData,
  levelId: string,
  paintedIndices: readonly number[],
  updatedAt: number,
  completed = false,
  contentVersion = 1,
): SaveData => ({
  ...base,
  levels: {
    ...base.levels,
    [levelId]: {
      paintedMask: completed ? '' : paintedMaskFromIndices(paintedIndices),
      completed,
      contentVersion,
      updatedAt,
    },
  },
});

const imageConfig = () => validateImportConfig('fixture', {
  schemaVersion: 1,
  contentVersion: 1,
  id: 'image-fixture',
  order: 999,
  title: { ru: 'Тест', en: 'Test' },
  category: 'cute-objects',
  tags: { ru: ['тест'], en: ['test'] },
  grid: { columns: 20, rows: 20, colorCount: 3, padding: 1, removeWhiteBackground: true },
});

test('all 120 production levels are valid, unique, and follow the progressive grids', async () => {
  const levels = await levelsPromise;
  const replacedIds = new Set([
    'arcane-crystal-platform', 'winged-royal-crown', 'celestial-observatory-island', 'moon-cauldron',
    'moon-rabbit', 'crystal-stag', 'enchanted-koi-pond', 'star-bakery-cart', 'sakura-garden-arch',
    'sun-clockwork-guardian', 'stellar-planetary-mobile', 'underground-oasis', 'stellar-harp',
    'traveling-alchemy-cart', 'sun-moon-observatory',
  ]);
  assert.equal(levels.length, 120);
  assert.deepEqual([1, 2, 3, 4, 5].map((difficulty) => levels.filter(({ metadata }) => metadata.difficulty === difficulty).length), [10, 15, 25, 50, 20]);
  assert.deepEqual(levels.map(({ metadata }) => metadata.order), Array.from({ length: 120 }, (_, index) => index + 1));
  assert.ok(levels.slice(1).every(({ metadata }, index) => metadata.difficulty >= levels[index].metadata.difficulty), 'difficulty must not drop between levels');
  for (const { metadata, compiled } of levels) {
    const grid = gridForOrder(metadata.order);
    assert.equal(compiled.viewBox, `0 0 ${grid.columns} ${grid.rows}`);
    assert.ok(compiled.regions.length >= 60 && compiled.regions.length <= 8100);
    assert.ok(metadata.difficulty >= 1 && metadata.difficulty <= 5);
    assert.equal(new Set(compiled.regions.map((r) => r.index)).size, compiled.regions.length);
    assert.equal(Boolean(compiled.previousContent), !replacedIds.has(metadata.id));
  }
});

test('levels 041–049 retain their own titles and corrected artwork palettes', async () => {
  const expected = [
    ['arcane-crystal-platform', '#1B1B27'], ['winged-royal-crown', '#420748'], ['celestial-observatory-island', '#2B2B70'],
    ['moon-cauldron', '#212034'], ['moon-rabbit', '#242941'], ['crystal-stag', '#1C3C2D'],
    ['enchanted-koi-pond', '#283F1D'], ['star-bakery-cart', '#3A1A3B'], ['sakura-garden-arch', '#232225'],
  ];
  const byId = new Map((await levelsPromise).map(({ metadata, compiled }) => [metadata.id, { metadata, compiled }]));
  const corrected = expected.map(([id]) => byId.get(id)!);
  assert.deepEqual(corrected.map(({ compiled }) => [compiled.id, compiled.colors[0].value]), expected);
  assert.ok(corrected.every(({ metadata, compiled }) =>
    compiled.contentVersion === (metadata.id === 'sakura-garden-arch' ? 4 : 3) && !compiled.previousContent));
});

test('measured level complexity has no adjacent drop greater than 25%', async () => {
  const levels = await levelsPromise;
  const scores = levels.map(levelComplexity);
  for (let index = 1; index < scores.length; index += 1) {
    const change = (scores[index].score - scores[index - 1].score) / scores[index - 1].score;
    assert.ok(change >= -.25, `${levels[index - 1].metadata.id} -> ${levels[index].metadata.id}: ${(change * 100).toFixed(2)}%`);
  }
  const averages = [1, 2, 3, 4, 5].map((difficulty) => {
    const group = levels.filter(({ metadata }) => metadata.difficulty === difficulty).map(levelComplexity);
    return group.reduce((sum, item) => sum + item.score, 0) / group.length;
  });
  assert.ok(averages.slice(1).every((average, index) => average > averages[index]));
});

test('desktop SDK frame remains within 2:1 for every moderation viewport', () => {
  for (const row of checkDesktopFrames()) {
    console.log(`${row.viewportWidth}x${row.viewportHeight} -> ${row.width}x${row.height} -> ${row.ratio.toFixed(3)}`);
    assert.ok(row.ratio <= 2);
  }
});

test('ad policy uses two completions, a 120-second cooldown, and correct sticky routes', () => {
  assert.equal(canRequestFullscreen(1, 0, 500_000), false);
  assert.equal(canRequestFullscreen(2, 400_001, 520_000), false);
  assert.equal(canRequestFullscreen(2, 400_000, 520_000), true);
  assert.equal(shouldShowStickyBanner(null), true, 'start and catalog show sticky');
  assert.equal(shouldShowStickyBanner('flower'), false, 'gameplay, tutorial and completion hide sticky');
});

test('pixel indexes are deterministic row/column coordinates, not DOM positions', async () => {
  for (const { compiled } of await levelsPromise) {
    const indexes = compiled.regions.map((region) => region.index);
    assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
    compiled.regions.forEach((region) => {
      assert.equal(region.index, (region.labelY - .5) * Math.max(30, gridDimensions(compiled.viewBox).width) + region.labelX - .5);
    });
  }
});

test('every target color has a different neutral shade before painting', async () => {
  for (const { compiled } of await levelsPromise) {
    const shades = getUnpaintedColorMap(compiled.colors);
    assert.equal(shades.size, compiled.colors.length);
    assert.equal(new Set(shades.values()).size, compiled.colors.length);
    assert.ok([...shades.values()].every((shade) => /^rgb\(\d+ \d+ \d+\)$/.test(shade)));
  }
});

test('version 1 and 2 saves migrate automatically to compact V3 masks', async () => {
  const migratedV1 = migrateSaveData({
    version: 1,
    levels: { cat: { paintedRegionIds: ['head', 'head', 7], completed: false, updatedAt: 20 } },
    settings: { sound: false, language: 'ru' },
    lastPlayedLevelId: 'cat',
    updatedAt: 25,
  });
  assert.ok(migratedV1);
  assert.equal(migratedV1.version, 3);
  assert.equal(migratedV1.levels.cat.contentVersion, 1);
  assert.equal(hasPaintedIndex(decodePaintedMask(migratedV1.levels.cat.paintedMask), legacyRegionIndex('head')), true);
  assert.equal(migratedV1.settings.updatedAt, 25);
  assert.equal(migratedV1.meta.lastPlayedLevelId, 'cat');

  const migratedV2 = migrateSaveData({
    version: 2,
    levels: { flower: { paintedRegionIds: ['p-r04-c08'], completed: false, updatedAt: 30 } },
    settings: { sound: true, language: 'auto', updatedAt: 1 },
    meta: { updatedAt: 1 },
  });
  assert.ok(migratedV2);
  assert.equal(hasPaintedIndex(decodePaintedMask(migratedV2.levels.flower.paintedMask), pixelIndex(7, 3)), true);

  const cat = (await levelsPromise).find(({ compiled }) => compiled.id === 'cat')?.compiled;
  assert.ok(cat);
  const expected = cat.regions.filter(({ legacyRegionId }) => legacyRegionId === 'head').length;
  assert.ok(expected > 1);
  assert.equal(countPaintedBits(getLevelProgress(cat, migratedV1.levels.cat).paintedMask), expected);
});

test('a changed contentVersion safely resets stale geometry progress', async () => {
  const level = (await levelsPromise)[0].compiled;
  const stale = {
    paintedMask: paintedMaskFromIndices([level.regions[0].index]),
    completed: false,
    contentVersion: level.contentVersion,
    updatedAt: 40,
  };
  const changed: PaintLevel = { ...level, contentVersion: level.contentVersion + 1 };
  const normalized = getLevelProgress(changed, stale);
  assert.equal(normalized.paintedMask, '');
  assert.equal(normalized.completed, false);
  assert.equal(normalized.contentVersion, changed.contentVersion);
  assert.equal(normalized.updatedAt, 40);
});

test('drag logic batches correct pixels, skips wrong pixels, and removes duplicates', async () => {
  const level = (await levelsPromise)[0].compiled;
  const empty = getLevelProgress(level);
  const colorId = getNextIncompleteColor(level, empty);
  assert.ok(colorId !== null);
  const correct = getRemainingRegionsForColor(level, empty, colorId).slice(0, 5).map(({ id }) => id);
  const wrong = level.regions.find((region) => region.colorId !== colorId)?.id;
  assert.equal(correct.length, 5);
  assert.ok(wrong);

  const five = filterPaintStroke(level, empty, colorId, correct);
  assert.equal(five.length, 5);
  const mixed = filterPaintStroke(level, empty, colorId, [correct[0], wrong, correct[1]]);
  assert.deepEqual(mixed, correct.slice(0, 2));
  const unique = filterPaintStroke(level, empty, colorId, [correct[0], correct[0], correct[1], correct[1]]);
  assert.deepEqual(unique, correct.slice(0, 2));

  const partial = paintRegions(level, empty, five, 10);
  assert.equal(countPaintedBits(partial.paintedMask), 5);
  assert.equal(countPaintedBits(empty.paintedMask), 0);
  assert.deepEqual(filterPaintStroke(level, partial, colorId, correct), []);
});

test('painting remains immutable and completes at exactly 100%', async () => {
  const level = (await levelsPromise)[0].compiled;
  const empty = getLevelProgress(level);
  const firstColor = getNextIncompleteColor(level, empty);
  assert.equal(firstColor, 1);
  const firstColorIds = getRemainingRegionsForColor(level, empty, firstColor).map(({ id }) => id);
  const colorDone = paintRegions(level, empty, firstColorIds, 20);
  assert.equal(isColorCompleted(level, colorDone, firstColor), true);
  assert.equal(getNextIncompleteColor(level, colorDone, firstColor), 2);
  const completed = paintRegions(level, colorDone, level.regions.map(({ id }) => id), 30);
  assert.equal(completed.completed, true);
  assert.equal(completed.paintedMask, '', 'completed levels keep no unnecessary bitset');
  assert.equal(getLevelProgressPercent(level, completed), 100);
});

test('120 progressive levels fit the V3 cloud save budget even when every picture is partially painted', () => {
  let save = createDefaultSave();
  for (let level = 0; level < 120; level += 1) {
    const grid = gridForOrder(level + 1).columns;
    const partial = true;
    const completed = false;
    const indexes = partial
      ? Array.from({ length: grid * grid }, (_, index) => index)
        .filter((index) => index % 3 === 0)
        .map((index) => Math.floor(index / grid) * Math.max(30, grid) + index % grid)
      : [];
    save = withLevel(save, `level-${String(level + 1).padStart(3, '0')}`, indexes, level + 1, completed);
  }
  const bytes = Buffer.byteLength(JSON.stringify(save));
  console.log(`Simulated cloud save size: ${(bytes / 1024).toFixed(2)} KB`);
  assert.ok(bytes < 150 * 1024, `V3 save is ${(bytes / 1024).toFixed(2)} KB`);
});

test('reward scales 10/15/25/40/60, falls back from completed colors, and finishes a small remainder', async () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((difficulty) => getRewardPixelCount(difficulty as 1 | 2 | 3 | 4 | 5)), [10, 15, 25, 40, 60]);
  const level = (await levelsPromise)[0].compiled;
  const empty = getLevelProgress(level);
  const reward = getRewardRegions(level, empty, 1);
  assert.equal(reward.length, 10);
  assert.ok(reward.every((r) => r.colorId === 1));
  const colorDone = paintRegions(level, empty, level.regions.filter((r) => r.colorId === 1).map((r) => r.id));
  const fallback = getRewardRegions(level, colorDone, 1);
  assert.ok(fallback.length > 0 && fallback.length <= 10);
  assert.ok(fallback.every((r) => r.colorId !== 1));
  const remaining = [level.regions[0], level.regions.find((r) => r.colorId === 2)!, level.regions.at(-1)!];
  const almost = paintRegions(level, empty, level.regions.filter((r) => !remaining.includes(r)).map((r) => r.id));
  assert.equal(getRewardRegions(level, almost, 1).length, 3);
  assert.equal(paintRegions(level, almost, getRewardRegions(level, almost, 1).map((r) => r.id)).completed, true);
  const done = paintRegions(level, empty, level.regions.map((r) => r.id));
  assert.deepEqual(getRewardRegions(level, done, 1), []);
});

test('legacy completed and partial geometry progress survives the progressive content upgrade', async () => {
  for (const { compiled: level } of await levelsPromise) {
    const prior = level.previousContent;
    if (!prior) continue;
    const completed = getLevelProgress(level, { paintedMask: '', completed: true, contentVersion: prior.contentVersion, updatedAt: 9 });
    assert.equal(completed.completed, true);
    assert.equal(completed.contentVersion, level.contentVersion);
    const { width, height } = gridDimensions(level.viewBox);
    const target = level.regions[Math.floor(level.regions.length / 2)];
    const oldIndex = Math.floor(target.labelY / height * prior.rows) * Math.max(30, prior.columns) + Math.floor(target.labelX / width * prior.columns);
    const migrated = getLevelProgress(level, { paintedMask: paintedMaskFromIndices([oldIndex]), completed: false, contentVersion: prior.contentVersion, updatedAt: 10 });
    assert.ok(hasPaintedIndex(decodePaintedMask(migrated.paintedMask), target.index));
    assert.equal(migrated.updatedAt, 10);
  }
});

test('continue finds the most recently painted unfinished level and never mistakes rounded 99% for completion', async () => {
  const manifest = JSON.parse(await readFile(generatedManifestPath, 'utf8'));
  let save = withLevel(createDefaultSave(), manifest[0].id, [1], 10, false, manifest[0].contentVersion);
  save = withLevel(save, manifest[1].id, [1], 20, false, manifest[1].contentVersion);
  save = { ...save, meta: { lastPlayedLevelId: manifest[2].id, updatedAt: 30 } };
  assert.equal(findContinueLevel(manifest, save)?.id, manifest[1].id);
  const sample = (await levelsPromise)[0].compiled;
  const unpainted = Math.max(1, Math.ceil(sample.regions.length * .01));
  const almost = paintRegions(sample, undefined, sample.regions.slice(unpainted).map((r) => r.id));
  assert.ok(getLevelProgressPercent(sample, almost) < 100);
  assert.ok(manifestProgress(manifest[0], almost) < 100);
});

test('progression boundaries and manual difficulty overrides are stable', async () => {
  assert.deepEqual([1, 10, 11, 25, 26, 50, 51, 75, 76, 100, 101, 120, 125, 300].map((n) => gridForOrder(n).columns),
    [24, 24, 30, 30, 45, 45, 65, 65, 75, 75, 90, 90, 90, 90]);
  const config = validateImportConfig('fixture', { ...imageConfig(), difficulty: 4, locked: true });
  assert.equal(config.locked, true);
  const result = { columns: 20, rows: 20, palette: [{ id: 1, color: '#123456' }], cells: Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), colorId: 1 })) };
  assert.equal(JSON.parse(makeLevelFiles(config, result).metadata).difficulty, 4);
  assert.ok(initialScaleForGrid(90) >= 4.5);
});

test('music and tutorial settings migrate and persist without changing Save V3', () => {
  const initial = migrateSaveData({ version: 3, levels: {}, settings: { sound: false } })!;
  assert.equal(initial.settings.tutorialCompleted, false);
  assert.equal(initial.settings.music, true);
  const updated = { ...initial, settings: { ...initial.settings, music: false, tutorialCompleted: true, updatedAt: 10 } };
  const restored = migrateSaveData(JSON.parse(JSON.stringify(updated)))!;
  assert.equal(restored.version, 3);
  assert.equal(restored.settings.music, false);
  assert.equal(restored.settings.sound, false);
  assert.equal(restored.settings.tutorialCompleted, true);
});

test('Yandex ads grant once, serialize requests, route sticky, and never block on errors', async () => {
  const host = globalThis as unknown as { window: unknown };
  const previous = host.window;
  let callbacks: { onOpen?: () => void; onRewarded?: () => void; onClose?: (shown?: boolean) => void; onError?: () => void } = {};
  let fullscreenCallbacks: typeof callbacks = {};
  let grants = 0;
  let sticky = false;
  let bannerShows = 0;
  let bannerHides = 0;
  host.window = { setTimeout, clearTimeout, YaGames: { init: async () => ({ adv: {
    showRewardedVideo: (options: { callbacks: typeof callbacks }) => { callbacks = options.callbacks; },
    showFullscreenAdv: (options: { callbacks: typeof callbacks }) => { fullscreenCallbacks = options.callbacks; },
    getBannerAdvStatus: async () => ({ stickyAdvIsShowing: sticky }),
    showBannerAdv: async () => { bannerShows += 1; sticky = true; return { stickyAdvIsShowing: true }; },
    hideBannerAdv: async () => { bannerHides += 1; sticky = false; return { stickyAdvIsShowing: false }; },
  } }) } };
  try {
    const sdk = await import('../src/services/yandexSDK.ts');
    await sdk.initYandex();
    assert.equal(await setStickyBannerVisible(true), true);
    assert.equal(await setStickyBannerVisible(true), false, 'duplicate show is skipped internally');
    assert.equal(await setStickyBannerVisible(false), true);
    assert.equal(await setStickyBannerVisible(true), true, 'catalog return shows sticky again');
    assert.equal(bannerShows, 2);
    assert.equal(bannerHides, 1);

    let request = sdk.requestRewardedVideo(() => grants++);
    assert.equal(grants, 0);
    callbacks.onClose?.();
    assert.equal(await request, false);
    callbacks.onRewarded?.();
    assert.equal(grants, 0);
    request = sdk.requestRewardedVideo(() => grants++);
    callbacks.onError?.();
    assert.equal(await request, false);
    request = sdk.requestRewardedVideo(() => grants++);
    callbacks.onRewarded?.();
    callbacks.onRewarded?.();
    assert.equal(grants, 1, 'grant is synchronous with onRewarded, before onClose');
    callbacks.onClose?.();
    assert.equal(await request, true);
    assert.equal(grants, 1);

    let pauses = 0;
    let resumes = 0;
    const first = showRewardedAd(() => { pauses += 1; }, () => { resumes += 1; }, () => { grants += 1; });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const parallel = showRewardedAd(() => undefined, () => undefined, () => { grants += 1; });
    assert.equal(await parallel, false, 'a second ad request must not start in parallel');
    callbacks.onOpen?.();
    callbacks.onClose?.();
    assert.equal(await first, false, 'close without onRewarded grants nothing');
    assert.equal(grants, 1);
    assert.equal(pauses, 1);
    assert.equal(resumes, 1);

    const originalNow = Date.now;
    let now = 500_000;
    Date.now = () => now;
    try {
      recordLevelCompletion();
      assert.equal(await maybeShowFullscreenAd(() => undefined, () => undefined), false);
      recordLevelCompletion();
      const fullscreen = maybeShowFullscreenAd(() => { pauses += 1; }, () => { resumes += 1; });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      fullscreenCallbacks.onOpen?.();
      fullscreenCallbacks.onClose?.(true);
      assert.equal(await fullscreen, true);

      recordLevelCompletion();
      recordLevelCompletion();
      assert.equal(await maybeShowFullscreenAd(() => undefined, () => undefined), false, 'cooldown blocks an immediate request');
      now += 120_000;
      const failed = maybeShowFullscreenAd(() => { pauses += 1; }, () => { resumes += 1; });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      fullscreenCallbacks.onOpen?.();
      fullscreenCallbacks.onError?.();
      assert.equal(await failed, false, 'fullscreen error resolves so navigation can continue');
    } finally {
      Date.now = originalNow;
    }
  } finally {
    (await import('../src/services/audio.ts')).resumeAudio();
    host.window = previous;
  }
});

test('Yandex deviceInfo object is the source of the root device class', async () => {
  const host = globalThis as unknown as { window: unknown; document: unknown };
  const previous = { window: host.window, document: host.document };
  const classes = new Set<string>();
  host.document = { documentElement: { classList: {
    add: (...values: string[]) => values.forEach((value) => classes.add(value)),
    remove: (...values: string[]) => values.forEach((value) => classes.delete(value)),
  } } };
  host.window = {
    setTimeout,
    clearTimeout,
    YaGames: { init: async () => ({ deviceInfo: { type: 'mobile', isMobile: () => true } }) },
  };
  try {
    const sdk = await import('../src/services/yandexSDK.ts?device-class-test');
    assert.equal(await sdk.initYandex(), true);
    assert.deepEqual([...classes], ['yandex-device-mobile']);
  } finally {
    Object.assign(host, previous);
  }
});

test('SDK skips unchanged cloud data before calling player.setData', async () => {
  const host = globalThis as unknown as { window: unknown };
  const previous = host.window;
  let writes = 0;
  const cloud = { save: { version: 3 } };
  const player = {
    getData: async () => cloud,
    setData: async () => { writes += 1; },
    isAuthorized: () => true,
  };
  host.window = { setTimeout, clearTimeout, YaGames: { init: async () => ({ getPlayer: async () => player }) } };
  try {
    const sdk = await import('../src/services/yandexSDK.ts?cloud-dedup-test');
    await sdk.initYandex();
    assert.equal((await sdk.readCloudData('save')).status, 'success');
    assert.equal(await sdk.writeCloudData('save', { version: 3 }, true), true);
    assert.equal(writes, 0, 'data just read from the cloud must not be written back unchanged');
    assert.equal(await sdk.writeCloudData('save', { version: 4 }, true), true);
    assert.equal(await sdk.writeCloudData('save', { version: 4 }, true), true);
    assert.equal(writes, 1, 'the same local value must only be sent once');
  } finally { host.window = previous; }
});

test('Web Audio music pauses for focus/visibility and music mute is independent from SFX', async () => {
  const host = globalThis as unknown as { window: unknown; document: unknown; fetch: unknown };
  const previous = { window: host.window, document: host.document, fetch: host.fetch };
  let starts = 0;
  let stops = 0;
  class MockGain { gain = { value: 0 }; connect() { return this; } }
  class MockSource {
    loop = false;
    buffer: unknown;
    onended: (() => void) | null = null;
    connect() { return this; }
    start() { starts += 1; }
    stop() { stops += 1; }
    disconnect() {}
  }
  class MockAudioContext {
    currentTime = 0;
    destination = {};
    createGain() { return new MockGain(); }
    createBufferSource() { return new MockSource(); }
    createOscillator() { return { type: 'sine', frequency: { setValueAtTime() {} }, connect() { return this; }, start() {}, stop() {}, disconnect() {}, onended: null }; }
    decodeAudioData() { return Promise.resolve({}); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  const documentMock = { baseURI: 'http://localhost/', visibilityState: 'visible', hasFocus: () => true };
  host.window = { AudioContext: MockAudioContext };
  host.document = documentMock;
  host.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    const audio = await import('../src/services/audio.ts');
    audio.setMusicScene('menu');
    assert.equal(starts, 0, 'autoplay waits for a gesture');
    audio.unlockAudio();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    assert.equal(starts, 1);
    audio.setSoundEnabled(false);
    assert.equal(stops, 0, 'SFX mute must not stop the music');
    audio.pauseAudio();
    assert.equal(stops, 1);
    documentMock.visibilityState = 'hidden';
    audio.resumeAudio();
    assert.equal(starts, 1);
    documentMock.visibilityState = 'visible';
    audio.resumeAudio();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    assert.equal(starts, 2);
    audio.setMusicEnabled(false);
    audio.resumeAudio();
    assert.equal(starts, 2);
    audio.pauseAudio();
  } finally { Object.assign(host, previous); }
});

test('the cloud debounce coalesces 20 paint updates into one write', async () => {
  const debounce = createSaveDebouncer(8);
  let writes = 0;
  let last = -1;
  for (let index = 0; index < 20; index += 1) {
    debounce.schedule(() => { writes += 1; last = index; });
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  assert.equal(writes, 1);
  assert.equal(last, 19);
  debounce.cancel();
});

test('large grids get readable initial zoom, adaptive numbers, and hint centering', () => {
  assert.equal(initialScaleForGrid(20), 1);
  assert.ok(initialScaleForGrid(24) >= 1.25);
  assert.ok(initialScaleForGrid(27) >= 1.5);
  assert.ok(initialScaleForGrid(30) >= 1.7);
  assert.ok(numberSizeForGrid(30) >= .5 && numberSizeForGrid(30) <= .56);
  assert.deepEqual(gridDimensions('0 0 30 24'), { width: 30, height: 24 });

  const geometry = { boxWidth: 300, boxHeight: 300, viewBoxWidth: 30, viewBoxHeight: 30, scale: 2 };
  const offset = cameraOffsetForPoint({ x: 29.5, y: .5 }, geometry);
  const screenX = 150 + (29.5 / 30 - .5) * 300 * 2 + offset.x;
  const screenY = 150 + (.5 / 30 - .5) * 300 * 2 + offset.y;
  assert.ok(Math.abs(screenX - 150) < .001 && Math.abs(screenY - 150) < .001, 'far hint pixel must become visible at center');
});

test('ordinary image import removes only edge background and emits a valid pixel level', async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
    '<rect width="100" height="100" fill="white"/>' +
    '<rect x="10" y="10" width="80" height="80" fill="#ef4438"/>' +
    '<rect x="30" y="30" width="20" height="20" fill="white"/>' +
    '<rect x="58" y="58" width="20" height="20" fill="#386be8"/>' +
    '</svg>',
  );
  const config = imageConfig();
  const result = await pixelateImageBuffer(await sharp(source).png().toBuffer(), config.grid);
  assert.equal(result.cells.length, 324);
  assert.equal(result.palette.length, 3);
  assert.ok(result.cells.every(({ x, y }) => x > 0 && x < 19 && y > 0 && y < 19));
  assert.ok(result.palette.some(({ color }) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > 220;
  }), 'enclosed white detail must survive: ' + JSON.stringify(result.palette));
  const files = makeLevelFiles(config, result);
  const compiled = compileLevelSources('image-fixture', files.metadata, files.artwork);
  assert.equal(compiled.compiled.regions.length, 324);
  assert.ok(compiled.compiled.regions.every(({ path }) => /^M \d+ \d+ H \d+ V \d+ H \d+ Z$/.test(path)));
});

test('PNG, JPEG with EXIF orientation, and WebP rectangular sources are accepted', async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">' +
    '<rect width="160" height="90" fill="#fff"/><rect x="20" y="15" width="120" height="60" fill="#3875df"/></svg>',
  );
  const base = sharp(source);
  const buffers = [
    await base.clone().png().toBuffer(),
    await base.clone().jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    await base.clone().webp().toBuffer(),
  ];
  for (const buffer of buffers) {
    const result = await pixelateImageBuffer(buffer, imageConfig().grid);
    assert.ok(result.cells.length >= 60);
    assert.equal(result.columns, 20);
    assert.equal(result.rows, 20);
  }
});

test('import fingerprints include source, level config, global defaults, and importer version', () => {
  const source = Buffer.from('source');
  const config = Buffer.from('{"id":"fox"}');
  const defaults = Buffer.from('{"grid":{"columns":20}}');
  const fingerprint = createImportFingerprint(source, config, defaults, 2);
  assert.notEqual(fingerprint, createImportFingerprint(Buffer.from('changed'), config, defaults, 2));
  assert.notEqual(fingerprint, createImportFingerprint(source, Buffer.from('{}'), defaults, 2));
  assert.notEqual(fingerprint, createImportFingerprint(source, config, Buffer.from('{}'), 2));
  assert.notEqual(fingerprint, createImportFingerprint(source, config, defaults, 3));
});

test('batch importer uses defaults, skips unchanged files, reports failures, and preserves human metadata', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'numbi-image-import-'));
  const importRoot = resolve(temporaryRoot, 'imports');
  const levelRoot = resolve(temporaryRoot, 'levels');
  const sourceFolder = resolve(importRoot, '011-fox');
  const sourcePath = resolve(sourceFolder, 'source.png');
  let processed = 0;
  const trackProcessing = { onProcess: () => { processed += 1; } };
  try {
    await mkdir(sourceFolder, { recursive: true });
    await writeFile(resolve(importRoot, 'defaults.json'), JSON.stringify({
      schemaVersion: 1,
      contentVersion: 1,
      grid: { columns: 20, rows: 20, colorCount: 2, padding: 1, removeWhiteBackground: true },
    }));
    const makeSource = (innerColor) => sharp(Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
      '<rect width="100" height="100" fill="white"/>' +
      '<rect x="10" y="10" width="80" height="80" fill="#ef4438"/>' +
      `<rect x="35" y="35" width="30" height="30" fill="${innerColor}"/>` +
      '</svg>',
    )).png().toBuffer();
    await writeFile(sourcePath, await makeSource('#386be8'));
    await writeFile(resolve(sourceFolder, 'import.json'), JSON.stringify({
      id: 'fox',
      order: 11,
      title: { ru: 'Лисёнок', en: 'Little Fox' },
      category: 'animals',
      tags: { ru: ['лиса'], en: ['fox'] },
    }));

    const first = await importImages(importRoot, levelRoot, trackProcessing);
    assert.equal(first.imported.length, 1);
    assert.equal(first.failed.length, 0);
    assert.equal(processed, 1);
    assert.equal((await importImages(importRoot, levelRoot, trackProcessing)).skipped.length, 1);
    assert.equal(processed, 1, 'cache hit must skip before Sharp processing');

    const metadataPath = resolve(levelRoot, '011-fox/level.json');
    const manual = JSON.parse(await readFile(metadataPath, 'utf8'));
    manual.title.ru = 'Ручное название';
    manual.category = 'nature';
    manual.tags.ru = ['ручной тег'];
    await writeFile(metadataPath, JSON.stringify(manual, null, 2) + '\n');
    await writeFile(sourcePath, await makeSource('#24b873'));
    const refused = await importImages(importRoot, levelRoot, trackProcessing);
    assert.equal(refused.failed.length, 1);
    assert.match(refused.failed[0].error, /Refusing to overwrite/);
    assert.equal(processed, 2, 'changed source must invalidate the fingerprint');

    const forced = await importImages(importRoot, levelRoot, { force: true, ...trackProcessing });
    assert.equal(forced.imported.length, 1);
    assert.equal(processed, 3, '--force must bypass the cache');
    const preserved = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.equal(preserved.title.ru, 'Ручное название');
    assert.equal(preserved.category, 'nature');
    assert.deepEqual(preserved.tags.ru, ['ручной тег']);
    assert.equal(preserved.contentVersion, 2);
    await validateLevelDirectory(resolve(levelRoot, '011-fox'));
    assert.equal((await importImages(importRoot, levelRoot, trackProcessing)).skipped.length, 1);
    assert.equal(processed, 3);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('import QA warns about dominant colors, sparse occupancy, close colors, and isolated pixels', () => {
  const result = {
    columns: 20,
    rows: 20,
    requestedColorCount: 3,
    palette: [
      { id: 1, color: '#AA6655' },
      { id: 2, color: '#AC6857' },
    ],
    cells: [
      ...Array.from({ length: 70 }, (_, index) => ({ x: index % 18 + 1, y: Math.floor(index / 18) * 2 + 1, colorId: 1 })),
      { x: 1, y: 15, colorId: 2 }, { x: 3, y: 15, colorId: 2 }, { x: 5, y: 15, colorId: 2 },
      { x: 7, y: 15, colorId: 2 }, { x: 9, y: 15, colorId: 2 }, { x: 11, y: 15, colorId: 2 },
      { x: 13, y: 15, colorId: 2 }, { x: 15, y: 15, colorId: 2 },
    ],
  };
  const warnings = analyzePixelLevel(result).join(' ');
  assert.match(warnings, /low occupancy/);
  assert.match(warnings, /dominant color/);
  assert.match(warnings, /isolated/);
  assert.match(warnings, /visually close/);
  assert.match(warnings, /collapsed/);
});

test('merge keeps newer settings and newer per-level masks independently', () => {
  const local: SaveData = {
    ...createDefaultSave(),
    settings: { sound: false, language: 'ru', updatedAt: 200 },
  };
  const cloud = withLevel({
    ...createDefaultSave(),
    settings: { sound: true, language: 'en', updatedAt: 100 },
  }, 'flower', [1], 150);
  const merged = mergeSaveData(local, cloud);
  assert.equal(merged.settings.sound, false);
  assert.equal(merged.settings.language, 'ru');
  assert.equal(countPaintedBits(merged.levels.flower.paintedMask), 1);

  const newerLocal = withLevel(createDefaultSave(), 'flower', [1, 2], 300);
  const olderCloud = withLevel(createDefaultSave(), 'flower', [1], 200);
  assert.equal(countPaintedBits(mergeSaveData(newerLocal, olderCloud).levels.flower.paintedMask), 2);
});

test('a newer reset beats older 80% cloud state without unioning bitsets', () => {
  const local = withLevel(createDefaultSave(), 'flower', [], 400);
  const cloud = withLevel(createDefaultSave(), 'flower', Array.from({ length: 80 }, (_, index) => index), 300);
  const merged = mergeSaveData(local, cloud);
  assert.equal(merged.levels.flower.paintedMask, '');
  assert.equal(merged.levels.flower.completed, false);
  assert.equal(merged.levels.flower.updatedAt, 400);
});

test('cloud read error cannot trigger an automatic cloud write', async () => {
  let writes = 0;
  const dependencies: CloudSyncDependencies = {
    openAuth: async () => true,
    refreshPlayer: async () => true,
    isAuthorized: async () => true,
    read: async () => ({ status: 'error', error: new Error('network') }),
    write: async () => { writes += 1; return true; },
  };
  const result = await hydrateCloudSave(withLevel(createDefaultSave(), 'flower', [1], 100), () => undefined, dependencies);
  assert.equal(result.status, 'error');
  assert.equal(writes, 0);
});

test('explicit auth checks Player before and after the dialog, then merges and writes', async () => {
  const order: string[] = [];
  let authorized = false;
  const local = withLevel(createDefaultSave(), 'flower', [1], 100);
  const cloud = withLevel(createDefaultSave(), 'flower', [1, 2], 200);
  const dependencies: CloudSyncDependencies = {
    openAuth: async () => { order.push('openAuthDialog'); authorized = true; return true; },
    refreshPlayer: async () => { order.push('getPlayer'); return true; },
    isAuthorized: async () => { order.push('isAuthorized'); return authorized; },
    read: async () => { order.push('getData'); return { status: 'success', save: cloud }; },
    write: async () => { order.push('setData'); return true; },
  };
  const result = await synchronizeAccount(local, (merged) => {
    order.push('applyMerge');
    assert.equal(countPaintedBits(merged.levels.flower.paintedMask), 2);
  }, true, dependencies);
  assert.equal(result.written, true);
  assert.deepEqual(order, ['getPlayer', 'isAuthorized', 'openAuthDialog', 'getPlayer', 'isAuthorized', 'getData', 'applyMerge', 'setData']);
});

test('an already authorized player never receives an auth dialog', async () => {
  let dialogs = 0;
  const dependencies: CloudSyncDependencies = {
    openAuth: async () => { dialogs += 1; return true; },
    refreshPlayer: async () => true,
    isAuthorized: async () => true,
    read: async () => ({ status: 'success', save: null }),
    write: async () => true,
  };
  const result = await synchronizeAccount(createDefaultSave(), () => undefined, true, dependencies);
  assert.equal(result.status, 'success');
  assert.equal(dialogs, 0);
});

test('validator reports the required broken asset cases', async () => {
  const { metadata, artwork } = await loadTemplate();
  const parsed = JSON.parse(metadata);
  assert.throws(() => compileLevelSources('broken-json', '{', artwork), /malformed level\.json/);
  assert.throws(() => compileLevelSources('missing-viewbox', metadata, artwork.replace(/ viewBox="[^"]+"/, '')), /viewBox/);
  assert.throws(() => compileLevelSources('unknown-color', metadata, artwork.replace('data-color-id="1"', 'data-color-id="99"')), /missing colorId 99/);
  assert.throws(() => compileLevelSources('missing-label', metadata, artwork.replace(/ data-label-x="[^"]+"/, '')), /data-label-x/);
  assert.throws(() => compileLevelSources('off-grid', metadata, artwork.replace('M 4 0 H 5 V 1 H 4 Z', 'M 4.2 0 H 5.2 V 1 H 4.2 Z')), /1x1 pixel cell/);
  const regionIds = [...artwork.matchAll(/data-region-id="([^"]+)"/g)].map((match) => match[1]);
  assert.throws(
    () => compileLevelSources('duplicate-region', metadata, artwork.replace(`data-region-id="${regionIds[1]}"`, `data-region-id="${regionIds[0]}"`)),
    /duplicate region id/,
  );
  assert.throws(() => compileLevelSources('empty-palette', JSON.stringify({ ...parsed, palette: [] }), artwork), /palette must not be empty/);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'numbi-validator-'));
  try {
    await writeFile(resolve(temporaryRoot, 'level.json'), metadata);
    await assert.rejects(validateLevelDirectory(temporaryRoot), /artwork\.svg is missing/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('validator detects duplicate level IDs across folders', async () => {
  const { metadata, artwork } = await loadTemplate();
  const base = JSON.parse(metadata);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'numbi-duplicate-'));
  try {
    for (const [folder, order] of [['001-one', 1], ['002-two', 2]]) {
      const target = resolve(temporaryRoot, folder);
      await mkdir(target);
      await writeFile(resolve(target, 'level.json'), JSON.stringify({ ...base, id: 'same-id', order }));
      await writeFile(resolve(target, 'artwork.svg'), artwork);
    }
    await assert.rejects(validateLevels(temporaryRoot), /duplicate id/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('incremental level build skips unchanged outputs and supports --force semantics', async () => {
  const outputRoot = await mkdtemp(resolve(projectRoot, 'public/.incremental-test-'));
  const cachePath = resolve(outputRoot, 'build-cache.json');
  try {
    const levelCount = (await levelsPromise).length;
    const first = await buildLevels(contentRoot, outputRoot, { cachePath });
    const second = await buildLevels(contentRoot, outputRoot, { cachePath });
    const forced = await buildLevels(contentRoot, outputRoot, { cachePath, force: true });
    assert.equal(first.builtCount, levelCount);
    assert.equal(second.builtCount, 0);
    assert.equal(second.skippedCount, levelCount);
    assert.equal(forced.builtCount, levelCount);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('300-entry development fixture filters quickly and contains no geometry', async () => {
  const manifest = JSON.parse(await readFile(generatedManifestPath, 'utf8'));
  assert.equal(manifest.length, 120, 'fake levels must not enter the production manifest');
  const fixture = makeCatalogFixture(manifest, 300);
  const started = performance.now();
  for (let run = 0; run < 100; run += 1) filterCatalog(fixture, {}, 'en', 'cat', 'animals', 'new');
  const elapsed = performance.now() - started;
  assert.equal(fixture.length, 300);
  assert.ok(elapsed < 200, `100 catalog filters took ${elapsed.toFixed(1)} ms`);
  assert.ok(fixture.every((entry) => !('regions' in entry) && !('colors' in entry) && !('viewBox' in entry)));
  assert.doesNotMatch(JSON.stringify(fixture), /"path"\s*:/);
  assert.equal(manifestProgress(fixture[0], undefined), 0);
});

test('Yandex size policy fails at the exact 95,000,000-byte internal limit', () => {
  assert.equal(classifyYandexSize(69_999_999), 'healthy');
  assert.equal(classifyYandexSize(70_000_000), 'warning');
  assert.equal(classifyYandexSize(80_000_000), 'strong-warning');
  assert.equal(classifyYandexSize(YANDEX_INTERNAL_LIMIT_BYTES - 1), 'strong-warning');
  assert.equal(classifyYandexSize(YANDEX_INTERNAL_LIMIT_BYTES), 'failure');
});

test('Yandex ZIP audit requires modern and legacy entries and rejects development files', () => {
  const bytes = (value = '') => new TextEncoder().encode(value);
  const runtime = {
    'index.html': bytes('<script type="module" src="assets/app.js"></script><script nomodule src="assets/app-legacy.js"></script>'),
    'assets/app.js': bytes(),
    'assets/app.css': bytes(),
    'generated/levels-manifest.json': bytes('[]'),
  };
  assert.deepEqual(validateEntries(runtime), ['assets', 'generated', 'index.html']);
  assert.throws(() => validateEntries({ ...runtime, 'index.html': bytes('<script type="module"></script>') }), /legacy browser entry/);
  for (const forbidden of [
    'node_modules/react/index.js',
    'src/main.tsx',
    'tests/game.test.ts',
    'qa/catalog.html',
    'content/imports/011-fox/source.png',
    'assets/source.jpg',
    '.cache/import-images/cache.json',
    'release/old-release.zip',
  ]) {
    assert.throws(() => validateEntries({ ...runtime, [forbidden]: bytes() }), /forbidden/);
  }
});
