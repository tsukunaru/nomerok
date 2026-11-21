import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultContentRoot = resolve(projectRoot, 'content/levels');
const defaultOutputRoot = resolve(projectRoot, 'public/generated');
const defaultCachePath = resolve(projectRoot, '.cache/levels-build.json');
const buildSignature = 'numbi-level-build-v5-png-thumbnails';

export const CATEGORY_SLUGS = [
  'animals', 'nature', 'food', 'houses-cities', 'space',
  'transport', 'underwater', 'fantasy', 'landscapes', 'cute-objects',
];

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hexPattern = /^#[0-9a-f]{6}$/i;

const parseAttributes = (source) => {
  const attributes = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) attributes[match[1]] = match[3];
  return attributes;
};

const requiredText = (value, label, errors) => {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${label} must be a non-empty string`);
};

const requiredTags = (value, label, errors) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((tag) => typeof tag !== 'string' || !tag.trim())) {
    errors.push(`${label} must contain at least one non-empty string`);
  }
};

const fail = (folderName, errors) => {
  if (errors.length) throw new Error(`Level ${folderName}:\n${errors.map((error) => `- ${error}`).join('\n')}`);
};

export const compileLevelSources = (folderName, metadataSource, artworkSource) => {
  let metadata;
  try {
    metadata = JSON.parse(metadataSource);
  } catch (error) {
    throw new Error(`Level ${folderName}:\n- malformed level.json: ${error.message}`);
  }

  const errors = [];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push('level.json root must be an object');
    metadata = {};
  }
  const allowedMetadataKeys = new Set(['schemaVersion', 'contentVersion', 'id', 'order', 'title', 'category', 'tags', 'difficulty', 'palette', 'previousContent']);
  if (metadata.previousContent) {
    const prior = metadata.previousContent;
    if (!Number.isInteger(prior.contentVersion) || prior.contentVersion < 1 || prior.contentVersion >= metadata.contentVersion ||
        !Number.isInteger(prior.columns) || prior.columns < 8 || prior.columns > 90 ||
        !Number.isInteger(prior.rows) || prior.rows < 8 || prior.rows > 90 ||
        !Number.isInteger(prior.regionCount) || prior.regionCount < 1 || prior.regionCount > prior.columns * prior.rows) {
      errors.push('invalid previousContent migration metadata');
    }
  }
  Object.keys(metadata).forEach((key) => !allowedMetadataKeys.has(key) && errors.push(`unsupported level.json property ${key}`));
  if (metadata.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Number.isInteger(metadata.contentVersion) || metadata.contentVersion < 1) errors.push('contentVersion must be a positive integer');
  if (typeof metadata.id !== 'string' || !slugPattern.test(metadata.id)) errors.push('id must be a lowercase stable slug');
  if (!Number.isInteger(metadata.order) || metadata.order < 1) errors.push('order must be a positive integer');
  requiredText(metadata.title?.ru, 'title.ru', errors);
  requiredText(metadata.title?.en, 'title.en', errors);
  if (typeof metadata.title?.ru === 'string' && metadata.title.ru.length > 80) errors.push('title.ru must be at most 80 characters');
  if (typeof metadata.title?.en === 'string' && metadata.title.en.length > 80) errors.push('title.en must be at most 80 characters');
  if (!CATEGORY_SLUGS.includes(metadata.category)) errors.push(`category must be one of: ${CATEGORY_SLUGS.join(', ')}`);
  requiredTags(metadata.tags?.ru, 'tags.ru', errors);
  requiredTags(metadata.tags?.en, 'tags.en', errors);
  for (const language of ['ru', 'en']) {
    if (Array.isArray(metadata.tags?.[language]) && metadata.tags[language].some((tag) => typeof tag === 'string' && tag.length > 40)) {
      errors.push(`tags.${language} entries must be at most 40 characters`);
    }
  }
  if (![1, 2, 3, 4, 5].includes(metadata.difficulty)) errors.push('difficulty must be 1 to 5');

  const palette = Array.isArray(metadata.palette) ? metadata.palette : [];
  if (palette.length === 0) errors.push('palette must not be empty');
  if (palette.length > 12) errors.push('palette must contain at most 12 colors');
  const colorIds = new Set();
  palette.forEach((color, index) => {
    if (!Number.isInteger(color?.id) || color.id < 1) errors.push(`palette[${index}].id must be a positive integer`);
    else if (colorIds.has(color.id)) errors.push(`duplicate palette color id ${color.id}`);
    else colorIds.add(color.id);
    if (typeof color?.color !== 'string' || !hexPattern.test(color.color)) errors.push(`palette[${index}].color must be #RRGGBB`);
  });

  if (typeof artworkSource !== 'string' || !/<svg\b/i.test(artworkSource) || !/<\/svg>\s*$/i.test(artworkSource)) {
    errors.push('artwork.svg must contain a complete <svg> root');
  }
  if (/<(?:script|image|foreignObject|text)\b/i.test(artworkSource)) errors.push('artwork.svg contains a forbidden UI or external-content element');
  if (/\b(?:transform|on[a-z]+)\s*=/i.test(artworkSource)) errors.push('artwork.svg contains a forbidden transform or event handler');
  const svgTag = artworkSource.match(/<svg\b([^>]*)>/i);
  const viewBox = svgTag ? parseAttributes(svgTag[1]).viewBox : undefined;
  const viewBoxNumbers = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (viewBoxNumbers.length !== 4 || viewBoxNumbers.some((value) => !Number.isFinite(value)) || viewBoxNumbers[2] <= 0 || viewBoxNumbers[3] <= 0) {
    errors.push('SVG viewBox must contain four finite numbers with positive width and height');
  } else if (viewBoxNumbers[0] !== 0 || viewBoxNumbers[1] !== 0 ||
      !Number.isInteger(viewBoxNumbers[2]) || !Number.isInteger(viewBoxNumbers[3]) ||
      viewBoxNumbers[2] < 8 || viewBoxNumbers[2] > 90 || viewBoxNumbers[3] < 8 || viewBoxNumbers[3] > 90) {
    errors.push('pixel SVG viewBox must be 0 0 width height with integer dimensions from 8 to 90');
  }

  const regionGroup = [...artworkSource.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/gi)]
    .find((match) => parseAttributes(match[1]).id === 'regions');
  if (!regionGroup) errors.push('SVG must contain <g id="regions">');

  const regions = [];
  const regionIds = new Set();
  const gridCells = new Set();
  const usedColors = new Set();
  if (regionGroup) {
    for (const [index, match] of [...regionGroup[2].matchAll(/<path\b([^>]*)\/?\s*>/gi)].entries()) {
      const attributes = parseAttributes(match[1]);
      const regionId = attributes['data-region-id'];
      const legacyRegionId = attributes['data-legacy-region-id'];
      const colorId = Number(attributes['data-color-id']);
      const labelX = Number(attributes['data-label-x']);
      const labelY = Number(attributes['data-label-y']);
      const path = attributes.d?.trim();
      const prefix = regionId || `path[${index}]`;
      if (!regionId || !slugPattern.test(regionId)) errors.push(`${prefix} has an invalid data-region-id`);
      else if (regionIds.has(regionId)) errors.push(`duplicate region id ${regionId}`);
      else regionIds.add(regionId);
      if (!Number.isInteger(colorId)) errors.push(`${prefix} has an invalid data-color-id`);
      else if (!colorIds.has(colorId)) errors.push(`${prefix} references missing colorId ${colorId}`);
      else usedColors.add(colorId);
      if (!Number.isFinite(labelX)) errors.push(`${prefix} is missing numeric data-label-x`);
      if (!Number.isFinite(labelY)) errors.push(`${prefix} is missing numeric data-label-y`);
      if (!path) errors.push(`${prefix} is missing path d`);
      else if (!/[zZ]\s*$/.test(path)) errors.push(`${prefix} path must be closed with Z`);
      const cell = path?.match(/^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+H\s+(-?\d+(?:\.\d+)?)\s+V\s+(-?\d+(?:\.\d+)?)\s+H\s+(-?\d+(?:\.\d+)?)\s+Z$/i);
      const cellX = cell ? Number(cell[1]) : NaN;
      const cellY = cell ? Number(cell[2]) : NaN;
      if (path && (!cell || !Number.isInteger(cellX) || !Number.isInteger(cellY) ||
          Number(cell[3]) - cellX !== 1 || Number(cell[4]) - cellY !== 1 || Number(cell[5]) !== cellX)) {
        errors.push(`${prefix} must be one axis-aligned 1x1 pixel cell path`);
      }
      if (cell) {
        const cellKey = `${cellX}:${cellY}`;
        if (gridCells.has(cellKey)) errors.push(`${prefix} overlaps another pixel cell at ${cellKey}`);
        else gridCells.add(cellKey);
        if (labelX !== cellX + .5 || labelY !== cellY + .5) errors.push(`${prefix} label must be centered in its pixel cell`);
        if (viewBoxNumbers.length === 4 &&
            (cellX < viewBoxNumbers[0] || cellY < viewBoxNumbers[1] ||
             cellX + 1 > viewBoxNumbers[0] + viewBoxNumbers[2] ||
             cellY + 1 > viewBoxNumbers[1] + viewBoxNumbers[3])) {
          errors.push(`${prefix} pixel cell is outside the viewBox`);
        }
      }
      if (legacyRegionId !== undefined && !slugPattern.test(legacyRegionId)) errors.push(`${prefix} has an invalid data-legacy-region-id`);
      if (regionId && Number.isInteger(colorId) && Number.isFinite(labelX) && Number.isFinite(labelY) && path) {
        regions.push({
          id: regionId,
          ...(legacyRegionId ? { legacyRegionId } : {}),
          index: Number.isInteger(cellX) && Number.isInteger(cellY) ? cellY * Math.max(30, viewBoxNumbers[2]) + cellX : -1,
          colorId,
          path,
          labelX,
          labelY,
        });
      }
    }
  }
  if (regions.length === 0) errors.push('artwork.svg must contain at least one playable path');
  palette.forEach((color) => Number.isInteger(color?.id) && !usedColors.has(color.id) && errors.push(`palette color ${color.id} is not used by any region`));
  if (regions.length < 60 || regions.length > 8100) errors.push('levels require 60-8100 playable pixels');
  if (viewBoxNumbers.length === 4 && viewBoxNumbers.every(Number.isFinite)) {
    const [x, y, width, height] = viewBoxNumbers;
    regions.forEach((region) => {
      if (region.labelX < x || region.labelX > x + width || region.labelY < y || region.labelY > y + height) {
        errors.push(`${region.id} label coordinates are outside the viewBox`);
      }
    });
  }
  fail(folderName, errors);
  const orderedRegions = regions.sort((left, right) =>
    left.labelY - right.labelY || left.labelX - right.labelX || left.id.localeCompare(right.id));

  return {
    metadata: {
      schemaVersion: 1,
      contentVersion: metadata.contentVersion,
      id: metadata.id,
      order: metadata.order,
      title: { ru: metadata.title.ru.trim(), en: metadata.title.en.trim() },
      category: metadata.category,
      tags: { ru: metadata.tags.ru.map((tag) => tag.trim()), en: metadata.tags.en.map((tag) => tag.trim()) },
      difficulty: metadata.difficulty,
      ...(metadata.previousContent ? { previousContent: metadata.previousContent } : {}),
      palette: palette.map(({ id, color }) => ({ id, color: color.toUpperCase() })),
    },
    compiled: {
      id: metadata.id,
      contentVersion: metadata.contentVersion,
      difficulty: metadata.difficulty,
      ...(metadata.previousContent ? { previousContent: metadata.previousContent } : {}),
      title: { ru: metadata.title.ru.trim(), en: metadata.title.en.trim() },
      viewBox: viewBox.trim().replace(/[\s,]+/g, ' '),
      colors: palette.map(({ id, color }) => ({ id, value: color.toUpperCase() })),
      regions: orderedRegions,
    },
  };
};

export const validateLevelDirectory = async (folderPath) => {
  const folderName = folderPath.split(/[\\/]/).at(-1);
  const metadataPath = resolve(folderPath, 'level.json');
  const artworkPath = resolve(folderPath, 'artwork.svg');
  const missing = [];
  if (!existsSync(metadataPath)) missing.push('level.json is missing');
  if (!existsSync(artworkPath)) missing.push('artwork.svg is missing');
  fail(folderName, missing);
  const [metadataSource, artworkSource] = await Promise.all([
    readFile(metadataPath, 'utf8'),
    readFile(artworkPath, 'utf8'),
  ]);
  return {
    ...compileLevelSources(folderName, metadataSource, artworkSource),
    sourceHash: createHash('sha256').update(buildSignature).update(metadataSource).update(artworkSource).digest('hex'),
  };
};

export const validateLevels = async (contentRoot = defaultContentRoot) => {
  const folders = (await readdir(contentRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!folders.length) throw new Error(`No level folders found in ${contentRoot}`);

  const results = [];
  const errors = [];
  for (const folder of folders) {
    try {
      results.push(await validateLevelDirectory(resolve(contentRoot, folder)));
    } catch (error) {
      errors.push(error.message);
    }
  }
  const ids = new Map();
  const orders = new Map();
  results.forEach(({ metadata }) => {
    if (ids.has(metadata.id)) errors.push(`Level ${metadata.id}: duplicate id also used by ${ids.get(metadata.id)}`);
    else ids.set(metadata.id, metadata.order);
    if (orders.has(metadata.order)) errors.push(`Level ${metadata.id}: duplicate order ${metadata.order} also used by ${orders.get(metadata.order)}`);
    else orders.set(metadata.order, metadata.id);
  });
  if (errors.length) throw new Error(errors.join('\n'));
  return results.sort((a, b) => a.metadata.order - b.metadata.order);
};

const manifestEntry = ({ metadata, compiled }, index) => ({
  id: metadata.id,
  contentVersion: metadata.contentVersion,
  // Catalog numbers follow the live list; authored order still determines the import grid.
  order: index + 1,
  title: metadata.title,
  category: metadata.category,
  tags: metadata.tags,
  difficulty: metadata.difficulty,
  gridSize: { columns: Number(compiled.viewBox.split(' ')[2]), rows: Number(compiled.viewBox.split(' ')[3]) },
  ...(metadata.previousContent ? { previousContent: metadata.previousContent } : {}),
  regionCount: compiled.regions.length,
  colorCount: compiled.colors.length,
  thumbnail: `generated/thumbnails/${metadata.id}.png`,
  levelData: `generated/levels/${metadata.id}.json`,
});

const xmlEscape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const thumbnailSvg = (compiled) => {
  const colors = new Map(compiled.colors.map(({ id, value }) => [id, value]));
  const width = Number(compiled.viewBox.split(' ')[2]);
  const strokeWidth = Number.isFinite(width) ? width / 800 : .025;
  const paths = compiled.regions.map((region) =>
    `<path d="${xmlEscape(region.path)}" fill="${colors.get(region.colorId)}" stroke="#6f7077" stroke-width="${strokeWidth}"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${compiled.viewBox}">${paths}</svg>`;
};

const assertOutputPath = (outputRoot) => {
  const publicRoot = resolve(projectRoot, 'public');
  if (outputRoot !== publicRoot && !outputRoot.startsWith(`${publicRoot}${sep}`)) {
    throw new Error(`Refusing to replace output outside public/: ${outputRoot}`);
  }
};

const readBuildCache = async (cachePath) => {
  try {
    const value = JSON.parse(await readFile(cachePath, 'utf8'));
    return value?.version === 1 && value.levels && typeof value.levels === 'object' ? value.levels : {};
  } catch {
    return {};
  }
};

const writeIfChanged = async (path, content) => {
  try {
    if (await readFile(path, 'utf8') === content) return false;
  } catch {
    // Missing output is created below.
  }
  await writeFile(path, content);
  return true;
};

const removeStaleOutputs = async (folder, extension, liveIds) => {
  let entries = [];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension) && !liveIds.has(entry.name.slice(0, -extension.length)))
    .map((entry) => rm(resolve(folder, entry.name), { force: true })));
};

export const buildLevels = async (
  contentRoot = defaultContentRoot,
  outputRoot = defaultOutputRoot,
  options = {},
) => {
  const levels = await validateLevels(contentRoot);
  assertOutputPath(outputRoot);
  const levelOutput = resolve(outputRoot, 'levels');
  const thumbnailOutput = resolve(outputRoot, 'thumbnails');
  await Promise.all([mkdir(levelOutput, { recursive: true }), mkdir(thumbnailOutput, { recursive: true })]);
  const cachePath = options.cachePath ?? defaultCachePath;
  const previousCache = options.force ? {} : await readBuildCache(cachePath);
  const liveIds = new Set(levels.map(({ compiled }) => compiled.id));
  await Promise.all([
    removeStaleOutputs(levelOutput, '.json', liveIds),
    removeStaleOutputs(thumbnailOutput, '.webp', new Set()),
    removeStaleOutputs(thumbnailOutput, '.png', liveIds),
  ]);
  const { default: sharp } = await import('sharp');
  sharp.concurrency(Math.min(4, Math.max(1, sharp.concurrency())));
  const changed = levels.filter(({ compiled, sourceHash }) => options.force ||
    previousCache[compiled.id] !== sourceHash ||
    !existsSync(resolve(levelOutput, `${compiled.id}.json`)) ||
    !existsSync(resolve(thumbnailOutput, `${compiled.id}.png`)));
  let cursor = 0;
  let finished = 0;
  const worker = async () => {
    while (cursor < changed.length) {
      const { compiled } = changed[cursor];
      cursor += 1;
      await writeFile(resolve(levelOutput, `${compiled.id}.json`), JSON.stringify(compiled));
      await sharp(Buffer.from(thumbnailSvg(compiled)))
        .resize(320, 320, { fit: 'contain', background: '#FFFFFF' })
        .flatten({ background: '#FFFFFF' })
        .png({ compressionLevel: 9, palette: true })
        .toFile(resolve(thumbnailOutput, `${compiled.id}.png`));
      finished += 1;
      options.onProgress?.(finished, changed.length, compiled.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, changed.length) }, worker));

  const manifest = levels.map(manifestEntry);
  await writeIfChanged(resolve(outputRoot, 'levels-manifest.json'), `${JSON.stringify(manifest)}\n`);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeIfChanged(cachePath, `${JSON.stringify({
    version: 1,
    levels: Object.fromEntries(levels.map(({ compiled, sourceHash }) => [compiled.id, sourceHash])),
  }, null, 2)}\n`);
  return {
    manifest,
    regionCount: levels.reduce((sum, level) => sum + level.compiled.regions.length, 0),
    builtCount: changed.length,
    skippedCount: levels.length - changed.length,
  };
};

export const makeCatalogFixture = (manifest, count = 300) => Array.from({ length: count }, (_, index) => {
  const source = manifest[index % manifest.length];
  const number = index + 1;
  return {
    ...source,
    id: `fixture-${String(number).padStart(3, '0')}`,
    order: number,
    title: { ru: `${source.title.ru} ${number}`, en: `${source.title.en} ${number}` },
  };
});

const run = async () => {
  const command = process.argv[2];
  if (command === 'validate') {
    const levels = await validateLevels();
    console.log(`Validated ${levels.length} levels with ${levels.reduce((sum, level) => sum + level.compiled.regions.length, 0)} pixel cells.`);
    return;
  }
  if (command === 'build') {
    const unknown = process.argv.slice(3).filter((argument) => argument !== '--force');
    if (unknown.length) throw new Error('Usage: node scripts/levels.mjs build [--force]');
    const result = await buildLevels(defaultContentRoot, defaultOutputRoot, {
      force: process.argv.includes('--force'),
      onProgress: (done, total) => process.stdout.write(`\rGenerating thumbnails: ${done} / ${total}`),
    });
    if (result.builtCount) process.stdout.write('\n');
    console.log(`Built ${result.builtCount}, skipped ${result.skippedCount}; ${result.manifest.length} levels and ${result.regionCount} pixel cells are ready.`);
    return;
  }
  if (command === 'fixture') {
    const levels = await validateLevels();
    const fixture = makeCatalogFixture(levels.map(manifestEntry), 300);
    const target = resolve(projectRoot, '.catalog-fixture/levels-manifest-300.json');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(fixture)}\n`);
    console.log(`Generated development-only 300-entry fixture: ${target}`);
    return;
  }
  throw new Error('Usage: node scripts/levels.mjs validate|build|fixture');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
