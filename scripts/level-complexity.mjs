import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLevels } from './levels.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const levelRoot = resolve(projectRoot, 'content/levels');
const importRoot = resolve(projectRoot, 'content/imports');
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const levelComplexity = ({ compiled }) => {
  const [,, width, height] = compiled.viewBox.split(' ').map(Number);
  const cells = new Map(compiled.regions.map((region) => [
    `${Math.floor(region.labelX)},${Math.floor(region.labelY)}`,
    region.colorId,
  ]));
  const seen = new Set();
  let colorEdges = 0;
  let isolated = 0;
  let smallDetails = 0;
  for (const [key, colorId] of cells) {
    const [x, y] = key.split(',').map(Number);
    let sameNeighbors = 0;
    for (const [dx, dy] of directions) {
      const neighbor = cells.get(`${x + dx},${y + dy}`);
      if (neighbor === colorId) sameNeighbors += 1;
      else if (neighbor !== undefined) colorEdges += 1;
    }
    if (sameNeighbors === 0) isolated += 1;
    if (seen.has(key)) continue;
    let componentSize = 0;
    const queue = [key];
    seen.add(key);
    while (queue.length) {
      const current = queue.pop();
      componentSize += 1;
      const [cellX, cellY] = current.split(',').map(Number);
      for (const [dx, dy] of directions) {
        const neighbor = `${cellX + dx},${cellY + dy}`;
        if (cells.get(neighbor) === colorId && !seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (componentSize <= 4) smallDetails += 1;
  }
  const regionCount = compiled.regions.length;
  const colorCount = compiled.colors.length;
  const density = regionCount / (width * height);
  const score = Math.round(
    regionCount + colorCount * 24 + colorEdges / 2 * .35 + isolated * 2 +
    smallDetails * 8 + density * 100 + width * height * 1.2,
  );
  return { regionCount, colorCount, density, isolated, smallDetails, score };
};

export const sortByComplexityWithinDifficulty = (levels) => {
  const groups = new Map();
  for (const level of levels) {
    const width = Number(level.compiled.viewBox.split(' ')[2]);
    const key = `${level.metadata.difficulty}:${width}`;
    groups.set(key, [...(groups.get(key) ?? []), level]);
  }
  return [...groups.keys()].sort((left, right) => {
    const [leftDifficulty, leftWidth] = left.split(':').map(Number);
    const [rightDifficulty, rightWidth] = right.split(':').map(Number);
    return leftDifficulty - rightDifficulty || leftWidth - rightWidth;
  }).flatMap((key) =>
    groups.get(key).sort((left, right) =>
      levelComplexity(left).score - levelComplexity(right).score || left.metadata.id.localeCompare(right.metadata.id)));
};

const updateRoot = async (root, filename, ordered) => {
  const folders = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const byId = new Map();
  for (const folder of folders) {
    const path = resolve(root, folder.name, filename);
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      byId.set(data.id, { folder: folder.name, path, data });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const moves = [];
  for (const [index, level] of ordered.entries()) {
    const record = byId.get(level.metadata.id);
    if (!record) continue;
    const order = index + 1;
    record.data.order = order;
    await writeFile(record.path, `${JSON.stringify(record.data, null, 2)}\n`);
    const targetName = `${String(order).padStart(3, '0')}-${level.metadata.id}`;
    if (record.folder !== targetName) moves.push({ source: resolve(root, record.folder), target: resolve(root, targetName) });
  }
  const token = `.complexity-sort-${randomUUID()}`;
  for (const [index, move] of moves.entries()) {
    move.temporary = resolve(root, `${token}-${index}`);
    if (!move.source.startsWith(root + sep) || !move.target.startsWith(root + sep)) throw new Error('Unsafe level move');
    await rename(move.source, move.temporary);
  }
  for (const move of moves) await rename(move.temporary, move.target);
};

const report = async (levels, outputPath) => {
  const rows = ['position\tlevelId\tdifficulty\tregionCount\tcolorCount\tdensity\tsmallDetails\tcomplexityScore\trelativeChange'];
  let previous = null;
  let maximumDrop = 0;
  let maximumDropPair = '';
  for (const [index, level] of levels.entries()) {
    const metrics = levelComplexity(level);
    const change = previous === null ? null : (metrics.score - previous.score) / previous.score;
    if (change !== null && change < maximumDrop) {
      maximumDrop = change;
      maximumDropPair = `${levels[index - 1].metadata.id} -> ${level.metadata.id}`;
    }
    rows.push([
      index + 1,
      level.metadata.id,
      level.metadata.difficulty,
      metrics.regionCount,
      metrics.colorCount,
      metrics.density.toFixed(4),
      metrics.smallDetails,
      metrics.score,
      change === null ? '' : (change * 100).toFixed(2) + '%',
    ].join('\t'));
    previous = metrics;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rows.join('\n')}\n`);
  return { maximumDrop, maximumDropPair };
};

export const buildComplexityReport = async ({ apply = false, outputPath = resolve(projectRoot, 'qa/level-complexity.tsv') } = {}) => {
  let levels = await validateLevels(levelRoot);
  if (apply) {
    const ordered = sortByComplexityWithinDifficulty(levels);
    await updateRoot(levelRoot, 'level.json', ordered);
    await updateRoot(importRoot, 'import.json', ordered);
    levels = await validateLevels(levelRoot);
  }
  return { outputPath, ...await report(levels, outputPath) };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
  buildComplexityReport({
    apply: process.argv.includes('--apply'),
    outputPath: outputArg ? resolve(projectRoot, outputArg.slice('--output='.length)) : undefined,
  }).then(({ outputPath, maximumDrop, maximumDropPair }) => {
    console.log(`Complexity report: ${outputPath}`);
    console.log(`Maximum adjacent drop: ${(maximumDrop * 100).toFixed(2)}%${maximumDropPair ? ` (${maximumDropPair})` : ''}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
