import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { auditYandexSize } from './check-yandex-size.mjs';
import { validateLevels } from './levels.mjs';
import { validateEntries } from './package-yandex.mjs';
import { levelComplexity } from './level-complexity.mjs';
import { checkDesktopFrames } from './check-desktop-frame.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');
const distRoot = resolve(projectRoot, 'dist');
const archivePath = resolve(projectRoot, 'release/numbi-yandex-final.zip');
const expectedLevelCount = 120;

const walk = async (folder) => {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  }))).flat();
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`Yandex audit failed: ${message}`);
};

const unique = (values, label) => {
  const seen = new Set();
  values.forEach((value) => {
    assert(!seen.has(value), `duplicate ${label}: ${value}`);
    seen.add(value);
  });
};

const runtimePath = (root, path) => {
  const target = resolve(root, path.split(/[?#]/)[0]);
  assert(target === root || target.startsWith(root + sep), `path escapes runtime root: ${path}`);
  return target;
};

const exists = async (path) => access(path).then(() => true).catch(() => false);

const verifyImage = async (path, width, height) => {
  const metadata = await sharp(path).metadata();
  assert(metadata.format === 'png', `promo asset is not PNG: ${relative(projectRoot, path)}`);
  assert(!metadata.hasAlpha && metadata.channels === 3, `promo asset must be 24-bit RGB PNG: ${relative(projectRoot, path)}`);
  assert(metadata.width === width && metadata.height === height, `unexpected promo dimensions: ${relative(projectRoot, path)}`);
  if (/screenshot-/i.test(path)) {
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    const corner = (x, y) => [0, 1, 2].map((channel) => data[(y * info.width + x) * info.channels + channel]).join(',');
    assert(![corner(0, 0), corner(info.width - 1, 0), corner(0, info.height - 1), corner(info.width - 1, info.height - 1)].every((value) => value === '141,106,224'), `decorative screenshot border remains: ${relative(projectRoot, path)}`);
  }
};

const verifyManifest = async (levels) => {
  const manifest = JSON.parse(await readFile(resolve(publicRoot, 'generated/levels-manifest.json'), 'utf8'));
  assert(Array.isArray(manifest) && manifest.length === expectedLevelCount, `expected ${expectedLevelCount} manifest entries`);
  assert(levels.length === expectedLevelCount, `expected ${expectedLevelCount} source levels`);
  unique(manifest.map(({ id }) => id), 'level ID');
  unique(manifest.map(({ title }) => title.ru.trim().toLocaleLowerCase('ru')), 'Russian title');
  unique(manifest.map(({ title }) => title.en.trim().toLowerCase()), 'English title');
  unique(manifest.map(({ thumbnail }) => thumbnail), 'thumbnail reference');
  unique(manifest.map(({ levelData }) => levelData), 'level data reference');
  const sourceById = new Map(levels.map((level) => [level.metadata.id, level]));
  for (const [index, entry] of manifest.entries()) {
    const source = sourceById.get(entry.id);
    assert(source, `manifest ID has no source level: ${entry.id}`);
    assert(entry.order === index + 1 && source.metadata.order === entry.order, `invalid order for ${entry.id}`);
    assert(entry.difficulty >= (manifest[index - 1]?.difficulty ?? 1), `difficulty drops at ${entry.id}`);
    assert(entry.contentVersion === source.metadata.contentVersion, `content version mismatch for ${entry.id}`);
    assert(entry.title.ru === source.metadata.title.ru && entry.title.en === source.metadata.title.en, `localized title mismatch for ${entry.id}`);
    assert(entry.title.ru.trim() && entry.title.en.trim(), `empty localized title for ${entry.id}`);
    assert(extname(entry.thumbnail) === '.png', `thumbnail is not PNG for ${entry.id}`);
    for (const root of [publicRoot, distRoot]) {
      const thumbnail = runtimePath(root, entry.thumbnail);
      const levelData = runtimePath(root, entry.levelData);
      assert(await exists(thumbnail), `missing ${relative(root, thumbnail)}`);
      assert(await exists(levelData), `missing ${relative(root, levelData)}`);
      const compiled = JSON.parse(await readFile(levelData, 'utf8'));
      assert(compiled.id === entry.id && compiled.title.ru === entry.title.ru && compiled.title.en === entry.title.en, `compiled level mismatch for ${entry.id}`);
    }
  }
  return manifest;
};

const verifyComplexity = (levels) => {
  let maximumDrop = 0;
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levelComplexity(levels[index - 1]).score;
    const current = levelComplexity(levels[index]).score;
    const change = (current - previous) / previous;
    maximumDrop = Math.min(maximumDrop, change);
    assert(change >= -.25, `complexity drops ${(change * 100).toFixed(2)}% at ${levels[index].metadata.id}`);
  }
  return maximumDrop;
};

const verifyPromo = async () => {
  for (const language of ['ru', 'en']) {
    await verifyImage(resolve(projectRoot, `promo/${language}/cover-${language}.png`), 800, 470);
    for (const number of [1, 2]) {
      await verifyImage(resolve(projectRoot, `promo/${language}/horizontal/screenshot-${number}-${language}-horizontal.png`), 1920, 1080);
      await verifyImage(resolve(projectRoot, `promo/${language}/vertical/screenshot-${number}-${language}-vertical.png`), 1080, 1920);
    }
  }
  await verifyImage(resolve(projectRoot, 'promo/shared/icon-512.png'), 512, 512);
};

const verifyIndexLinks = async () => {
  const source = await readFile(resolve(distRoot, 'index.html'), 'utf8');
  const links = [...source.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]);
  let brokenLinks = 0;
  for (const link of links) {
    if (/^(?:https?:|data:|#|\/sdk\.js$)/i.test(link)) continue;
    if (!await exists(runtimePath(distRoot, link))) brokenLinks += 1;
  }
  assert(brokenLinks === 0, `${brokenLinks} broken index.html links`);
  return brokenLinks;
};

export const auditYandex = async () => {
  assert(await exists(resolve(distRoot, 'index.html')), 'dist/index.html is missing; run npm run build first');
  assert(await exists(archivePath), 'final ZIP is missing; run npm run build:yandex first');
  const levels = await validateLevels();
  const maximumComplexityDrop = verifyComplexity(levels);
  const desktopFrames = checkDesktopFrames();
  const manifest = await verifyManifest(levels);
  await verifyPromo();
  const [publicFiles, distFiles, size, brokenLinks, archive] = await Promise.all([
    walk(publicRoot),
    walk(distRoot),
    auditYandexSize(distRoot),
    verifyIndexLinks(),
    readFile(archivePath),
  ]);
  assert(!publicFiles.some((path) => extname(path).toLowerCase() === '.webp'), 'public runtime contains WebP');
  assert(!distFiles.some((path) => /\.(?:webp|map)$/i.test(path)), 'dist contains unsupported WebP or source maps');
  assert(size.status !== 'failure', `unpacked dist is ${size.total} bytes`);
  const entries = unzipSync(new Uint8Array(archive));
  const topLevel = validateEntries(entries);
  assert(entries['generated/levels-manifest.json'], 'ZIP manifest is missing');
  const zipManifest = JSON.parse(new TextDecoder().decode(entries['generated/levels-manifest.json']));
  assert(zipManifest.length === manifest.length, 'ZIP manifest level count differs from runtime');
  for (const entry of zipManifest) {
    assert(entries[entry.thumbnail] && entries[entry.levelData], `ZIP is missing runtime files for ${entry.id}`);
  }
  return { levels: levels.length, brokenLinks, missingAssets: 0, duplicateIds: 0, duplicateTitles: 0, maximumComplexityDrop, desktopFrames, size, zipBytes: archive.byteLength, topLevel };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditYandex().then((result) => {
    console.log(`Yandex audit: PASS (${result.levels} levels, ${result.brokenLinks} broken links, ${result.size.total} unpacked bytes).`);
    console.log(`Complexity maximum drop: ${(result.maximumComplexityDrop * 100).toFixed(2)}%; desktop frames: ${result.desktopFrames.length}/11 PASS.`);
    console.log(`ZIP: ${(result.zipBytes / 1_000_000).toFixed(2)} MB; root: ${result.topLevel.join(', ')}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
