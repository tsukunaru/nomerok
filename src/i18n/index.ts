import { en } from './en.ts';
import { ru } from './ru.ts';

export const dictionaries = { ru, en };

export const formatText = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
