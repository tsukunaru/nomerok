import type { PaintColor } from './types.ts';

const luminance = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return red * .2126 + green * .7152 + blue * .0722;
};

export const getUnpaintedColorMap = (colors: readonly PaintColor[]) => {
  const ordered = [...colors].sort((left, right) =>
    luminance(left.value) - luminance(right.value) || left.id - right.id);
  return new Map(ordered.map((color, index) => {
    const shade = Math.round(152 + (ordered.length === 1 ? 36 : index * 72 / (ordered.length - 1)));
    return [color.id, 'rgb(' + shade + ' ' + shade + ' ' + shade + ')'];
  }));
};
