import { readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const promoRoot = resolve(projectRoot, 'promo');

const walk = async (folder) => {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  }))).flat();
};

const targets = (await walk(promoRoot)).filter((path) => /(?:cover|screenshot)-[^/\\]+\.png$/i.test(path));
const hasDecorativeFrame = async (path) => {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [0, 1, 2].map((channel) => data[(y * info.width + x) * info.channels + channel]).join(',');
  return info.width > 32 && info.height > 32 && [pixel(0, 0), pixel(info.width - 1, 0), pixel(0, info.height - 1), pixel(info.width - 1, info.height - 1)].every((value) => value === '141,106,224');
};
const results = await Promise.all(targets.map(async (path) => {
  const metadata = await sharp(path).metadata();
  const framed = /screenshot-/i.test(path) && await hasDecorativeFrame(path);
  const image = sharp(path).toColorspace('srgb').removeAlpha();
  const output = await (framed
    ? image.extract({ left: 16, top: 16, width: metadata.width - 32, height: metadata.height - 32 }).resize(metadata.width, metadata.height)
    : image
  ).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, output);
  return framed;
}));
console.log(`Normalized ${targets.length} promo PNG files to opaque sRGB PNG; removed ${results.filter(Boolean).length} decorative screenshot borders.`);
