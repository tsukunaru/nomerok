import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CATEGORY_SLUGS, compileLevelSources } from './levels.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultImportRoot = resolve(projectRoot, 'content/imports');
const defaultLevelRoot = resolve(projectRoot, 'content/levels');
const defaultImportCachePath = resolve(projectRoot, '.cache/import-images/cache.json');
export const IMPORTER_VERSION = 3;
export const gridForOrder = (order) => {
  const size = order <= 10 ? 24 : order <= 25 ? 30 : order <= 50 ? 45 : order <= 75 ? 65 : order <= 100 ? 75 : 90;
  return { columns: size, rows: size, colorCount: size <= 30 ? 7 : size <= 65 ? 9 : 12 };
};
const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const folderPattern = /^\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const gridKeys = new Set([
  'columns', 'rows', 'colorCount', 'padding', 'removeWhiteBackground',
  'whiteThreshold', 'alphaThreshold', 'mergeColorDistance',
]);

const fail = (folder, errors) => {
  if (errors.length) throw new Error('Import ' + folder + ':\n' + errors.map((error) => '- ' + error).join('\n'));
};

const integerInRange = (value, minimum, maximum) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

const trimLocalized = (value) => ({
  ru: value.ru.trim(),
  en: value.en.trim(),
});

export const validateImportDefaults = (value) => {
  const errors = [];
  const defaults = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowed = new Set(['schemaVersion', 'contentVersion', 'grid', 'progressiveGrid']);
  if (defaults.progressiveGrid !== undefined && typeof defaults.progressiveGrid !== 'boolean') errors.push('progressiveGrid must be boolean');
  Object.keys(defaults).forEach((key) => !allowed.has(key) && errors.push('unsupported defaults.json property ' + key));
  Object.keys(defaults.grid ?? {}).forEach((key) => !gridKeys.has(key) && errors.push('unsupported grid default ' + key));
  if (defaults.schemaVersion !== undefined && defaults.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (defaults.contentVersion !== undefined && (!Number.isInteger(defaults.contentVersion) || defaults.contentVersion < 1)) {
    errors.push('contentVersion must be a positive integer');
  }
  fail('defaults.json', errors);
  return defaults;
};

export const validateImportConfig = (folder, value) => {
  const errors = [];
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rootKeys = new Set(['schemaVersion', 'contentVersion', 'id', 'order', 'title', 'category', 'tags', 'grid', 'difficulty', 'locked']);
  if (config.difficulty !== undefined && !integerInRange(config.difficulty, 1, 5)) errors.push('difficulty must be 1 to 5');
  if (config.locked !== undefined && typeof config.locked !== 'boolean') errors.push('locked must be boolean');
  Object.keys(config).forEach((key) => !rootKeys.has(key) && errors.push('unsupported import.json property ' + key));
  Object.keys(config.grid ?? {}).forEach((key) => !gridKeys.has(key) && errors.push('unsupported grid property ' + key));
  if (config.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Number.isInteger(config.contentVersion) || config.contentVersion < 1) errors.push('contentVersion must be a positive integer');
  if (typeof config.id !== 'string' || !slugPattern.test(config.id)) errors.push('id must be a lowercase stable slug');
  if (!Number.isInteger(config.order) || config.order < 1) errors.push('order must be a positive integer');
  for (const language of ['ru', 'en']) {
    if (typeof config.title?.[language] !== 'string' || !config.title[language].trim()) {
      errors.push('title.' + language + ' must be a non-empty string');
    } else if (config.title[language].length > 80) {
      errors.push('title.' + language + ' must be at most 80 characters');
    }
    if (!Array.isArray(config.tags?.[language]) || config.tags[language].length === 0 ||
        config.tags[language].some((tag) => typeof tag !== 'string' || !tag.trim())) {
      errors.push('tags.' + language + ' must contain at least one non-empty string');
    } else if (config.tags[language].some((tag) => tag.length > 40)) {
      errors.push('tags.' + language + ' entries must be at most 40 characters');
    }
  }
  if (!CATEGORY_SLUGS.includes(config.category)) {
    errors.push('category must be one of: ' + CATEGORY_SLUGS.join(', '));
  }
  const grid = config.grid ?? {};
  if (!integerInRange(grid.columns, 12, 90)) errors.push('grid.columns must be an integer from 12 to 90');
  if (!integerInRange(grid.rows, 12, 90)) errors.push('grid.rows must be an integer from 12 to 90');
  if (!integerInRange(grid.colorCount, 1, 12)) errors.push('grid.colorCount must be an integer from 1 to 12');
  const padding = grid.padding ?? 1;
  if (!integerInRange(padding, 0, 6)) errors.push('grid.padding must be an integer from 0 to 6');
  if (integerInRange(grid.columns, 12, 90) && integerInRange(grid.rows, 12, 90) &&
      padding * 2 >= Math.min(grid.columns, grid.rows)) {
    errors.push('grid.padding leaves no drawable area');
  }
  if (grid.removeWhiteBackground !== undefined && typeof grid.removeWhiteBackground !== 'boolean') {
    errors.push('grid.removeWhiteBackground must be true or false');
  }
  const whiteThreshold = grid.whiteThreshold ?? 245;
  const alphaThreshold = grid.alphaThreshold ?? 72;
  const mergeColorDistance = grid.mergeColorDistance ?? 28;
  if (!integerInRange(whiteThreshold, 200, 255)) errors.push('grid.whiteThreshold must be an integer from 200 to 255');
  if (!integerInRange(alphaThreshold, 1, 255)) errors.push('grid.alphaThreshold must be an integer from 1 to 255');
  if (!integerInRange(mergeColorDistance, 0, 100)) errors.push('grid.mergeColorDistance must be an integer from 0 to 100');
  fail(folder, errors);
  return {
    ...config,
    contentVersion: config.contentVersion,
    title: trimLocalized(config.title),
    tags: {
      ru: config.tags.ru.map((tag) => tag.trim()),
      en: config.tags.en.map((tag) => tag.trim()),
    },
    grid: {
      columns: grid.columns,
      rows: grid.rows,
      colorCount: grid.colorCount,
      padding,
      removeWhiteBackground: grid.removeWhiteBackground ?? true,
      whiteThreshold,
      alphaThreshold,
      mergeColorDistance,
    },
  };
};

const clearEdgeBackground = (pixels, width, height, whiteThreshold, alphaThreshold) => {
  const count = width * height;
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const isBackground = (index) => {
    const offset = index * 4;
    return pixels[offset + 3] < alphaThreshold ||
      (pixels[offset] >= whiteThreshold && pixels[offset + 1] >= whiteThreshold && pixels[offset + 2] >= whiteThreshold);
  };
  const enqueue = (index) => {
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    pixels[index * 4 + 3] = 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
};

const visibleBounds = (pixels, width, height, alphaThreshold) => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
};

const distance = (left, right) =>
  (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
const packed = ({ r, g, b }) => r * 65536 + g * 256 + b;
const lightness = ({ r, g, b }) => r * .2126 + g * .7152 + b * .0722;
const nearestCenter = (color, centers) => centers
  .map((center, index) => ({ index, score: distance(color, center) }))
  .sort((left, right) => left.score - right.score || left.index - right.index)[0].index;

const updateCenters = (cells, centers, assignments) => {
  const totals = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
  cells.forEach((cell, index) => {
    const total = totals[assignments[index]];
    total.r += cell.r;
    total.g += cell.g;
    total.b += cell.b;
    total.count += 1;
  });
  return centers.map((center, index) => totals[index].count ? {
    r: Math.round(totals[index].r / totals[index].count),
    g: Math.round(totals[index].g / totals[index].count),
    b: Math.round(totals[index].b / totals[index].count),
  } : center);
};

const mergeCloseCenters = (cells, initialCenters, minimumDistance) => {
  const centers = initialCenters.map((center) => ({ ...center }));
  while (centers.length > 1 && minimumDistance > 0) {
    let closest = null;
    for (let left = 0; left < centers.length; left += 1) {
      for (let right = left + 1; right < centers.length; right += 1) {
        const score = distance(centers[left], centers[right]);
        if (!closest || score < closest.score) closest = { left, right, score };
      }
    }
    if (!closest || closest.score >= minimumDistance ** 2) break;
    const assignments = cells.map((cell) => nearestCenter(cell, centers));
    const totals = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    cells.forEach((cell, index) => {
      const total = totals[assignments[index]];
      total.r += cell.r;
      total.g += cell.g;
      total.b += cell.b;
      total.count += 1;
    });
    const left = totals[closest.left];
    const right = totals[closest.right];
    const count = left.count + right.count || 1;
    centers[closest.left] = {
      r: Math.round((left.r + right.r) / count),
      g: Math.round((left.g + right.g) / count),
      b: Math.round((left.b + right.b) / count),
    };
    centers.splice(closest.right, 1);
  }
  return centers;
};

export const quantizeCells = (cells, requestedCount, mergeColorDistance = 28) => {
  if (!cells.length) return { palette: [], cells: [] };
  const unique = [...new Map(cells.map((cell) => [packed(cell), { r: cell.r, g: cell.g, b: cell.b }])).values()];
  const count = Math.min(requestedCount, unique.length);
  let centers = [[...unique].sort((left, right) => lightness(left) - lightness(right) || packed(left) - packed(right))[0]];
  while (centers.length < count) {
    const candidate = unique
      .map((color) => ({ color, score: Math.min(...centers.map((center) => distance(color, center))) }))
      .sort((left, right) => right.score - left.score || packed(left.color) - packed(right.color))[0].color;
    centers.push({ ...candidate });
  }
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const assignments = cells.map((cell) => nearestCenter(cell, centers));
    centers = updateCenters(cells, centers, assignments);
  }
  centers = mergeCloseCenters(cells, centers, mergeColorDistance);
  const assignments = cells.map((cell) => nearestCenter(cell, centers));
  const used = [...new Set(assignments)].sort((left, right) =>
    lightness(centers[left]) - lightness(centers[right]) || packed(centers[left]) - packed(centers[right]));
  const remap = new Map(used.map((oldIndex, index) => [oldIndex, index + 1]));
  const hex = (value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase();
  return {
    palette: used.map((oldIndex, index) => ({
      id: index + 1,
      color: '#' + hex(centers[oldIndex].r) + hex(centers[oldIndex].g) + hex(centers[oldIndex].b),
    })),
    cells: cells.map((cell, index) => ({ x: cell.x, y: cell.y, colorId: remap.get(assignments[index]) })),
  };
};

export const pixelateImageBuffer = async (buffer, grid) => {
  // ponytail: 2048px bounds peak RAM and is sufficient for the supported 90-cell grids.
  const oriented = await sharp(buffer)
    .rotate()
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sourcePixels = Buffer.from(oriented.data);
  const { width, height } = oriented.info;
  if (grid.removeWhiteBackground) {
    clearEdgeBackground(sourcePixels, width, height, grid.whiteThreshold, grid.alphaThreshold);
  }
  const bounds = visibleBounds(sourcePixels, width, height, grid.alphaThreshold);
  if (!bounds) throw new Error('the image has no visible subject after background removal');
  const innerWidth = grid.columns - grid.padding * 2;
  const innerHeight = grid.rows - grid.padding * 2;
  let resized = sharp(sourcePixels, { raw: { width, height, channels: 4 } })
    .extract(bounds)
    .resize(innerWidth, innerHeight, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  if (grid.padding) {
    resized = resized.extend({
      top: grid.padding,
      bottom: grid.padding,
      left: grid.padding,
      right: grid.padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  const output = await resized.raw().toBuffer({ resolveWithObject: true });
  const cells = [];
  for (let y = 0; y < output.info.height; y += 1) {
    for (let x = 0; x < output.info.width; x += 1) {
      const offset = (y * output.info.width + x) * 4;
      if (output.data[offset + 3] < grid.alphaThreshold) continue;
      cells.push({ x, y, r: output.data[offset], g: output.data[offset + 1], b: output.data[offset + 2] });
    }
  }
  return {
    columns: grid.columns,
    rows: grid.rows,
    requestedColorCount: grid.colorCount,
    ...quantizeCells(cells, grid.colorCount, grid.mergeColorDistance),
  };
};

const rgbFromHex = (value) => ({
  r: Number.parseInt(value.slice(1, 3), 16),
  g: Number.parseInt(value.slice(3, 5), 16),
  b: Number.parseInt(value.slice(5, 7), 16),
});

export const analyzePixelLevel = (result) => {
  const warnings = [];
  const totalCells = result.columns * result.rows;
  const occupancy = result.cells.length / totalCells;
  if (occupancy < .22) warnings.push(`low occupancy: ${Math.round(occupancy * 100)}% of the grid is playable`);
  if (occupancy > .9) warnings.push(`high occupancy: ${Math.round(occupancy * 100)}% may indicate an unremoved background`);
  const colorCounts = new Map();
  result.cells.forEach(({ colorId }) => colorCounts.set(colorId, (colorCounts.get(colorId) ?? 0) + 1));
  const dominant = Math.max(0, ...colorCounts.values()) / Math.max(1, result.cells.length);
  if (dominant > .72) warnings.push(`dominant color covers ${Math.round(dominant * 100)}% of playable pixels`);
  const byCoordinate = new Map(result.cells.map((cell) => [`${cell.x}:${cell.y}`, cell.colorId]));
  const isolated = result.cells.filter(({ x, y, colorId }) =>
    [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .every(([nextX, nextY]) => byCoordinate.get(`${nextX}:${nextY}`) !== colorId)).length;
  if (isolated >= Math.max(6, Math.ceil(result.cells.length * .08))) {
    warnings.push(`${isolated} isolated single-color pixels may look noisy`);
  }
  let closestDistance = Infinity;
  for (let left = 0; left < result.palette.length; left += 1) {
    for (let right = left + 1; right < result.palette.length; right += 1) {
      closestDistance = Math.min(closestDistance, Math.sqrt(distance(
        rgbFromHex(result.palette[left].color),
        rgbFromHex(result.palette[right].color),
      )));
    }
  }
  if (closestDistance < 38) warnings.push(`two palette colors are visually close (RGB distance ${closestDistance.toFixed(1)})`);
  if (result.palette.length < result.requestedColorCount) {
    warnings.push(`palette collapsed from ${result.requestedColorCount} requested colors to ${result.palette.length}`);
  }
  if (result.cells.length < 90) warnings.push(`only ${result.cells.length} playable pixels; the picture may be too simple`);
  if (result.cells.some(({ x, y }) => x === 0 || y === 0 || x === result.columns - 1 || y === result.rows - 1)) {
    warnings.push('the subject touches the grid edge; consider padding 1 or 2');
  }
  return warnings;
};

export const difficultyForResult = (result) => {
  if (result.cells.length < 60) throw new Error('the pixel subject requires at least 60 cells');
  const size = Math.max(result.columns, result.rows);
  const score = size * .65 + Math.sqrt(result.cells.length) * .3 + result.palette.length * .4;
  return score < 26 ? 1 : score < 39 ? 2 : score < 59 ? 3 : score < 72 ? 4 : 5;
};

export const makeLevelFiles = (config, result, manualMetadata = {}) => {
  const metadata = {
    schemaVersion: 1,
    contentVersion: config.contentVersion,
    id: config.id,
    order: config.order,
    title: config.title,
    category: config.category,
    tags: config.tags,
    difficulty: config.difficulty ?? difficultyForResult(result),
    palette: result.palette,
    ...manualMetadata,
  };
  const digits = Math.max(2, String(Math.max(result.columns, result.rows)).length);
  const paths = result.cells.map((cell) => {
    const regionId = 'p-r' + String(cell.y + 1).padStart(digits, '0') + '-c' + String(cell.x + 1).padStart(digits, '0');
    return '    <path data-region-id="' + regionId + '" data-color-id="' + cell.colorId +
      '" data-label-x="' + (cell.x + .5) + '" data-label-y="' + (cell.y + .5) +
      '" d="M ' + cell.x + ' ' + cell.y + ' H ' + (cell.x + 1) + ' V ' + (cell.y + 1) +
      ' H ' + cell.x + ' Z" />';
  });
  const artwork = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + result.columns + ' ' + result.rows + '">',
    '  <g id="regions">',
    ...paths,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
  const metadataSource = JSON.stringify(metadata, null, 2) + '\n';
  compileLevelSources(config.id, metadataSource, artwork);
  return { metadata: metadataSource, artwork };
};

const parseJson = (source, label) => {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(label + ': ' + error.message);
  }
};

const readJson = async (path, label) => parseJson(await readFile(path, 'utf8'), label);

const loadDefaults = async (importRoot) => {
  const path = resolve(importRoot, 'defaults.json');
  if (!existsSync(path)) return { config: {}, source: Buffer.alloc(0) };
  const source = await readFile(path);
  return {
    config: validateImportDefaults(parseJson(source.toString('utf8'), 'Import defaults.json')),
    source,
  };
};

export const createImportFingerprint = (source, importConfig, defaults, importerVersion = IMPORTER_VERSION) => {
  const hash = createHash('sha256');
  for (const [name, value] of [
    ['importer', Buffer.from(String(importerVersion))],
    ['source', source],
    ['import.json', importConfig],
    ['defaults.json', defaults],
  ]) {
    hash.update(name + ':' + value.length + ':');
    hash.update(value);
  }
  return hash.digest('hex');
};

const loadImportDescriptor = async (folderPath, defaults, defaultsSource) => {
  const folder = folderPath.split(/[\\/]/).at(-1);
  fail(folder, folderPattern.test(folder) ? [] : ['folder name must be NNN-stable-slug using lowercase ASCII']);
  const configPath = resolve(folderPath, 'import.json');
  if (!existsSync(configPath)) throw new Error('Import ' + folder + ':\n- import.json is missing');
  const configSource = await readFile(configPath);
  const raw = parseJson(configSource.toString('utf8'), 'Import ' + folder + ': malformed import.json');
  const merged = {
    ...raw,
    schemaVersion: raw.schemaVersion ?? defaults.schemaVersion ?? 1,
    contentVersion: raw.contentVersion ?? defaults.contentVersion ?? 1,
    grid: { ...(defaults.grid ?? {}), ...(defaults.progressiveGrid ? gridForOrder(raw.order) : {}), ...(raw.grid ?? {}) },
  };
  const config = validateImportConfig(folder, merged);
  const targetName = String(config.order).padStart(3, '0') + '-' + config.id;
  fail(folder, folder === targetName ? [] : [`folder must be named ${targetName} to match order and id`]);
  const images = (await readdir(folderPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().startsWith('source.') &&
      supportedExtensions.has(extname(entry.name).toLowerCase()));
  fail(folder, images.length === 1 ? [] : ['expected exactly one source.png, source.jpg, source.jpeg, or source.webp']);
  const source = await readFile(resolve(folderPath, images[0].name));
  return {
    folder,
    config,
    source,
    targetName,
    fingerprint: createImportFingerprint(source, configSource, defaultsSource),
  };
};

const readImportCache = async (path) => {
  try {
    const cache = JSON.parse(await readFile(path, 'utf8'));
    return cache?.version === 1 && cache.entries && typeof cache.entries === 'object' ? cache.entries : {};
  } catch {
    return {};
  }
};

const writeImportCache = async (path, entries) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, entries }, null, 2) + '\n');
};

const manualFields = (metadata) => ({
  id: metadata.id,
  order: metadata.order,
  title: metadata.title,
  category: metadata.category,
  tags: metadata.tags,
  contentVersion: metadata.contentVersion,
  ...(metadata.previousContent ? { previousContent: metadata.previousContent } : {}),
});

const safeTarget = (levelRoot, targetName) => {
  const root = resolve(levelRoot);
  const target = resolve(root, targetName);
  if (!target.startsWith(root + sep) || !folderPattern.test(targetName)) {
    throw new Error('Unsafe image import target ' + targetName);
  }
  return target;
};

const sameFile = async (path, expected) => {
  try {
    return await readFile(path, 'utf8') === expected;
  } catch {
    return false;
  }
};

export const importImages = async (
  importRoot = defaultImportRoot,
  levelRoot = defaultLevelRoot,
  options = {},
) => {
  const defaults = await loadDefaults(importRoot);
  const folders = (await readdir(importRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const report = { imported: [], skipped: [], failed: [], warnings: [] };
  if (!folders.length) return report;
  const cachePath = options.cachePath ?? (
    resolve(importRoot) === defaultImportRoot && resolve(levelRoot) === defaultLevelRoot
      ? defaultImportCachePath
      : resolve(dirname(resolve(importRoot)), '.cache/import-images/cache.json')
  );
  const cache = await readImportCache(cachePath);
  const liveFolders = new Set(folders);
  Object.keys(cache).forEach((folder) => !liveFolders.has(folder) && delete cache[folder]);
  const targets = new Set();
  for (const folder of folders) {
    try {
      const loaded = await loadImportDescriptor(resolve(importRoot, folder), defaults.config, defaults.source);
      if (targets.has(loaded.targetName)) throw new Error('Duplicate image import target ' + loaded.targetName);
      targets.add(loaded.targetName);
      const target = safeTarget(levelRoot, loaded.targetName);
      const metadataPath = resolve(target, 'level.json');
      const artworkPath = resolve(target, 'artwork.svg');
      if (loaded.config.locked) {
        if (!existsSync(metadataPath) || !existsSync(artworkPath)) throw new Error('locked level output is missing');
        report.skipped.push({ id: loaded.config.id, folder, target, reason: 'locked' });
        continue;
      }
      const cached = cache[folder];
      if (!options.force && cached?.fingerprint === loaded.fingerprint &&
          existsSync(metadataPath) && existsSync(artworkPath)) {
        report.skipped.push({ id: loaded.config.id, folder, target, reason: 'unchanged (cache)' });
        if (Array.isArray(cached.warnings) && cached.warnings.length) {
          report.warnings.push({ id: loaded.config.id, messages: cached.warnings });
        }
        continue;
      }
      options.onProcess?.(folder);
      const result = await pixelateImageBuffer(loaded.source, loaded.config.grid);
      const warnings = analyzePixelLevel(result);
      let existing = null;
      if (existsSync(target)) {
        if (!existsSync(metadataPath) || !existsSync(artworkPath)) {
          throw new Error('existing target is incomplete; both level.json and artwork.svg are required');
        }
        existing = await readJson(metadataPath, 'Existing ' + loaded.targetName + '/level.json is malformed');
        if (existing.id !== loaded.config.id || existing.order !== loaded.config.order) {
          throw new Error('existing id/order no longer match its import folder; align them before reimporting');
        }
      }

      let files = makeLevelFiles(loaded.config, result, existing ? manualFields(existing) : {});
      if (existing && options.force) {
        const oldArtwork = await readFile(artworkPath, 'utf8');
        const generatedMetadata = JSON.parse(files.metadata);
        const contentChanged = oldArtwork !== files.artwork ||
          JSON.stringify(existing.palette) !== JSON.stringify(generatedMetadata.palette);
        if (contentChanged) {
          const oldLevel = compileLevelSources(loaded.targetName, JSON.stringify(existing), oldArtwork).compiled;
          const [, , columns, rows] = oldLevel.viewBox.split(' ').map(Number);
          files = makeLevelFiles(loaded.config, result, {
            ...manualFields(existing),
            contentVersion: Math.max(1, Number(existing.contentVersion) || 1) + 1,
            // ponytail: one prior geometry is supported; retain a migration chain before a second public grid revision.
            previousContent: { contentVersion: existing.contentVersion, columns, rows, regionCount: oldLevel.regions.length },
          });
        }
      }
      const unchanged = existing && await sameFile(metadataPath, files.metadata) && await sameFile(artworkPath, files.artwork);
      if (unchanged && !options.force) {
        report.skipped.push({ id: loaded.config.id, folder, target, reason: 'unchanged' });
      } else if (existing && !options.force) {
        report.failed.push({
          folder,
          error: 'Refusing to overwrite existing level ' + loaded.targetName + '; rerun with --force after reviewing the change',
        });
      } else {
        await mkdir(target, { recursive: true });
        await Promise.all([writeFile(metadataPath, files.metadata), writeFile(artworkPath, files.artwork)]);
        report.imported.push({
          id: loaded.config.id,
          folder,
          target,
          cellCount: result.cells.length,
          colorCount: result.palette.length,
          contentVersion: JSON.parse(files.metadata).contentVersion,
        });
      }
      if (unchanged || !existing || options.force) cache[folder] = { fingerprint: loaded.fingerprint, warnings };
      if (warnings.length) report.warnings.push({ id: loaded.config.id, messages: warnings });
    } catch (error) {
      report.failed.push({ folder, error: error.message });
    }
  }
  await writeImportCache(cachePath, cache);
  return report;
};

const run = async () => {
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--force');
  if (unknown.length) throw new Error('Usage: node scripts/import-images.mjs [--force]');
  console.log('Importing images...\n');
  const report = await importImages(defaultImportRoot, defaultLevelRoot, { force: process.argv.includes('--force') });
  report.imported.forEach((level) => {
    console.log(`${level.folder.padEnd(18)} imported (${level.cellCount} pixels, ${level.colorCount} colors, content v${level.contentVersion})`);
  });
  report.skipped.forEach((level) => console.log(`${level.folder.padEnd(18)} skipped`));
  report.warnings.forEach((warning) => warning.messages.forEach((message) => console.warn(`Warning ${warning.id}: ${message}.`)));
  report.failed.forEach((failure) => console.error(`Failed ${failure.folder}: ${failure.error}`));
  console.log(`\nImported: ${report.imported.length}`);
  console.log(`Skipped unchanged: ${report.skipped.length}`);
  console.log(`Failed: ${report.failed.length}`);
  console.log(`Warnings: ${report.warnings.reduce((sum, item) => sum + item.messages.length, 0)}`);
  if (report.failed.length) process.exitCode = 1;
  else console.log('Run npm run build:levels to regenerate the catalog.');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
