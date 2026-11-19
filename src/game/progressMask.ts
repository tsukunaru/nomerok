export const PIXEL_INDEX_STRIDE = 30;
const LEGACY_INDEX_OFFSET = PIXEL_INDEX_STRIDE * PIXEL_INDEX_STRIDE;

const legacyRegionIds = [
  'abdomen', 'attic-pane', 'attic-window', 'beak', 'body', 'body-bottom', 'body-middle', 'body-top',
  'branch', 'bubble-large', 'bubble-medium', 'bubble-small', 'bush-left', 'bush-right', 'cherry',
  'cherry-stem', 'chimney', 'cloud-left-one', 'cloud-left-two', 'cloud-mid-one', 'cloud-mid-two',
  'collar', 'cone', 'cone-line-four', 'cone-line-one', 'cone-line-three', 'cone-line-two', 'door',
  'door-window', 'drip-center', 'drip-left', 'drip-right', 'ear-left', 'ear-right', 'exhaust', 'eye',
  'eye-disk-left', 'eye-disk-right', 'eye-left', 'eye-right', 'feather-five', 'feather-four',
  'feather-one', 'feather-six', 'feather-three', 'feather-two', 'fin-bottom', 'fin-left',
  'fin-left-inner', 'fin-right', 'fin-right-inner', 'fin-top', 'flame-inner', 'flame-middle',
  'flame-outer', 'flower-center', 'flower-left', 'flower-right', 'foot-left', 'foot-right', 'ground',
  'head', 'house-roof', 'house-wall', 'iris-left', 'iris-right', 'leaf-left', 'leaf-right',
  'leg-bottom-left', 'leg-bottom-left-tip', 'leg-bottom-right', 'leg-bottom-right-tip', 'leg-top-left',
  'leg-top-left-tip', 'leg-top-right', 'leg-top-right-tip', 'mountain-center-back',
  'mountain-center-front', 'mountain-left-back', 'mountain-left-front', 'mountain-right-back',
  'mountain-right-front', 'muzzle-left', 'muzzle-right', 'nose', 'paw-left', 'paw-right',
  'petal-bottom', 'petal-bottom-left', 'petal-bottom-right', 'petal-left', 'petal-right', 'petal-top',
  'petal-top-left', 'petal-top-right', 'planet-left', 'planet-left-ring', 'planet-right',
  'planet-right-ring', 'plant-left', 'plant-mid-left', 'plant-mid-right', 'plant-right', 'pot-body',
  'pot-rim', 'pupil-left', 'pupil-right', 'ray-bottom', 'ray-bottom-left', 'ray-bottom-right',
  'ray-left', 'ray-right', 'ray-top', 'ray-top-left', 'ray-top-right', 'river-bottom', 'river-middle',
  'river-top', 'roof-left', 'roof-main', 'roof-right', 'scale-four', 'scale-one', 'scale-three',
  'scale-two', 'scoop-left', 'scoop-right', 'scoop-top', 'shell', 'shell-bottom-center',
  'shell-bottom-left', 'shell-bottom-right', 'shell-mid-left', 'shell-mid-right', 'shell-spot-five',
  'shell-spot-four', 'shell-spot-one', 'shell-spot-six', 'shell-spot-three', 'shell-spot-two',
  'shell-top-center', 'shell-top-left', 'shell-top-right', 'sky', 'smoke-one', 'smoke-two',
  'spot-left-bottom', 'spot-left-top', 'spot-right-bottom', 'spot-right-top', 'sprinkle-eight',
  'sprinkle-five', 'sprinkle-four', 'sprinkle-one', 'sprinkle-seven', 'sprinkle-six',
  'sprinkle-three', 'sprinkle-two', 'star-eight', 'star-five', 'star-four', 'star-one', 'star-seven',
  'star-six', 'star-three', 'star-two', 'stem', 'sun', 'tag', 'tail', 'tail-base', 'tail-lower',
  'tail-middle', 'tail-tip', 'tail-upper', 'thorax', 'tree-left-bottom', 'tree-left-mid',
  'tree-left-top', 'tree-right-bottom', 'tree-right-mid', 'tree-right-top', 'window-glass',
  'window-left-frame', 'window-left-pane', 'window-right-frame', 'window-right-pane', 'window-rim',
  'window-shine', 'wing-left-bottom', 'wing-left-lower', 'wing-left-lower-inner', 'wing-left-top',
  'wing-left-upper', 'wing-left-upper-inner', 'wing-right-bottom', 'wing-right-lower',
  'wing-right-lower-inner', 'wing-right-top', 'wing-right-upper', 'wing-right-upper-inner',
] as const;

const legacyIndices = new Map<string, number>(
  legacyRegionIds.map((id, index) => [id, LEGACY_INDEX_OFFSET + index]),
);

export const pixelIndex = (x: number, y: number) => y * PIXEL_INDEX_STRIDE + x;

export const legacyRegionIndex = (regionId: string) => legacyIndices.get(regionId) ?? -1;

export const indexFromPixelRegionId = (regionId: string) => {
  const match = regionId.match(/^p-r(\d+)-c(\d+)$/);
  if (!match) return legacyRegionIndex(regionId);
  const row = Number(match[1]) - 1;
  const column = Number(match[2]) - 1;
  return row >= 0 && row < PIXEL_INDEX_STRIDE && column >= 0 && column < PIXEL_INDEX_STRIDE
    ? pixelIndex(column, row)
    : -1;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const decodePaintedMask = (mask: string) => {
  if (!mask) return new Uint8Array();
  try {
    const binary = atob(mask);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
};

export const encodePaintedBytes = (source: Uint8Array) => {
  let length = source.length;
  while (length && source[length - 1] === 0) length -= 1;
  return length ? bytesToBase64(source.subarray(0, length)) : '';
};

export const hasPaintedIndex = (bytes: Uint8Array, index: number) =>
  index >= 0 && Boolean(bytes[index >> 3] & (1 << (index & 7)));

export const paintedMaskFromIndices = (indices: Iterable<number>) => {
  const values = [...new Set(indices)].filter((index) => Number.isInteger(index) && index >= 0);
  if (!values.length) return '';
  const bytes = new Uint8Array((Math.max(...values) >> 3) + 1);
  values.forEach((index) => { bytes[index >> 3] |= 1 << (index & 7); });
  return encodePaintedBytes(bytes);
};

export const addPaintedIndices = (mask: string, indices: Iterable<number>) => {
  const additions = [...new Set(indices)].filter((index) => Number.isInteger(index) && index >= 0);
  if (!additions.length) return mask;
  const current = decodePaintedMask(mask);
  const requiredLength = (Math.max(...additions) >> 3) + 1;
  const bytes = requiredLength > current.length ? new Uint8Array(requiredLength) : current.slice();
  if (bytes !== current) bytes.set(current);
  additions.forEach((index) => { bytes[index >> 3] |= 1 << (index & 7); });
  return encodePaintedBytes(bytes);
};

export const countPaintedBits = (mask: string) => {
  let count = 0;
  for (const byte of decodePaintedMask(mask)) {
    let value = byte;
    while (value) {
      value &= value - 1;
      count += 1;
    }
  }
  return count;
};
