import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir(new URL('../public/art/', import.meta.url), { recursive: true });
await sharp(fileURLToPath(new URL('../content/imports/026-grand-floating-castle/source.png', import.meta.url)))
  .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
  .flatten({ background: '#1B2031' })
  .png({ compressionLevel: 9, palette: true })
  .toFile(fileURLToPath(new URL('../public/art/menu-castle.png', import.meta.url)));
