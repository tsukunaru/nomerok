// One-time, idempotent conversion of the ten hand-authored pixel pictures.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { compileLevelSources } from './levels.mjs';
const root = new URL('../content/levels/', import.meta.url);
for (const folder of (await readdir(root)).sort().slice(0, 10)) {
  const metadataUrl = new URL(`${folder}/level.json`, root);
  const artworkUrl = new URL(`${folder}/artwork.svg`, root);
  const metadata = JSON.parse(await readFile(metadataUrl, 'utf8'));
  const artwork = await readFile(artworkUrl, 'utf8');
  const { compiled } = compileLevelSources(folder, JSON.stringify(metadata), artwork);
  if (compiled.viewBox === '0 0 24 24') continue;
  if (compiled.viewBox !== '0 0 20 20') throw new Error(`Unexpected starter grid: ${folder}`);
  const cells = new Map(compiled.regions.map((r) => [`${Math.floor(r.labelX)}:${Math.floor(r.labelY)}`, r]));
  const paths = [];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const source = cells.get(`${Math.floor((x + .5) * 20 / 24)}:${Math.floor((y + .5) * 20 / 24)}`);
    if (!source) continue;
    paths.push(`<path data-region-id="p-r${String(y + 1).padStart(2, '0')}-c${String(x + 1).padStart(2, '0')}"${source.legacyRegionId ? ` data-legacy-region-id="${source.legacyRegionId}"` : ''} data-color-id="${source.colorId}" data-label-x="${x + .5}" data-label-y="${y + .5}" d="M ${x} ${y} H ${x + 1} V ${y + 1} H ${x} Z" />`);
  }
  metadata.previousContent = { contentVersion: metadata.contentVersion, columns: 20, rows: 20, regionCount: compiled.regions.length };
  metadata.contentVersion++;
  metadata.difficulty = 1;
  const next = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g id="regions">\n${paths.join('\n')}\n</g></svg>\n`;
  compileLevelSources(folder, JSON.stringify(metadata), next);
  await writeFile(metadataUrl, JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(artworkUrl, next);
  console.log(`${folder}: 24x24, ${paths.length} cells`);
}
