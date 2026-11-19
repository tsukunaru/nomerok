import type { PaintColor } from '../game/types.ts';
import type { Translations } from '../i18n/types.ts';
import { Icon } from './Icon.tsx';

interface ColorPaletteProps {
  colors: readonly PaintColor[];
  selectedColorId: number | null;
  completedColorIds: readonly number[];
  t: Translations;
  onSelect: (colorId: number) => void;
}

export const ColorPalette = ({ colors, selectedColorId, completedColorIds, t, onSelect }: ColorPaletteProps) => {
  const complete = new Set(completedColorIds);
  return (
    <div className="palette" role="group" aria-label={t.chooseColor}>
      {colors.map((color) => {
        const finished = complete.has(color.id);
        return (
          <button
            className={`color-button ${selectedColorId === color.id ? 'is-selected' : ''} ${finished ? 'is-complete' : ''}`}
            key={color.id}
            style={{ '--paint-color': color.value } as React.CSSProperties}
            onClick={() => onSelect(color.id)}
            disabled={finished}
            aria-label={`${t.color} ${color.id}${finished ? `, ${t.done}` : ''}`}
          >
            <span>{color.id}</span>
            {finished && <Icon name="check" size={19} />}
          </button>
        );
      })}
    </div>
  );
};
