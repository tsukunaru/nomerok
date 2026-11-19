export type Language = 'ru' | 'en';
export type LanguageSetting = 'auto' | Language;
export type CategorySlug =
  | 'animals'
  | 'nature'
  | 'food'
  | 'houses-cities'
  | 'space'
  | 'transport'
  | 'underwater'
  | 'fantasy'
  | 'landscapes'
  | 'cute-objects';
export type CatalogStatus = 'all' | 'new' | 'in-progress' | 'completed';

export interface LocalizedText {
  readonly ru: string;
  readonly en: string;
}

export interface PaintColor {
  readonly id: number;
  readonly value: string;
}

export interface PaintRegion {
  readonly id: string;
  readonly legacyRegionId?: string;
  readonly index: number;
  readonly colorId: number;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
}

export interface PaintLevel {
  readonly previousContent?: PreviousContent;
  readonly id: string;
  readonly contentVersion: number;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly title: LocalizedText;
  readonly viewBox: string;
  readonly colors: readonly PaintColor[];
  readonly regions: readonly PaintRegion[];
}

export interface LevelManifestEntry {
  readonly previousContent?: PreviousContent;
  readonly gridSize?: { readonly columns: number; readonly rows: number };
  readonly id: string;
  readonly contentVersion: number;
  readonly order: number;
  readonly title: LocalizedText;
  readonly category: CategorySlug;
  readonly tags: Readonly<Record<Language, readonly string[]>>;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly regionCount: number;
  readonly colorCount: number;
  readonly thumbnail: string;
  readonly levelData: string;
}

export interface LevelProgress {
  readonly paintedMask: string;
  readonly completed: boolean;
  readonly contentVersion: number;
  readonly updatedAt: number;
}

export interface SaveSettings {
  readonly sound: boolean;
  readonly music?: boolean;
  readonly tutorialCompleted?: boolean;
  readonly language: LanguageSetting;
  readonly updatedAt: number;
}

export interface PreviousContent {
  readonly contentVersion: number;
  readonly columns: number;
  readonly rows: number;
  readonly regionCount: number;
}

export interface SaveMeta {
  readonly lastPlayedLevelId?: string;
  readonly updatedAt: number;
}

export interface SaveData {
  readonly version: 3;
  readonly levels: Readonly<Record<string, LevelProgress>>;
  readonly settings: SaveSettings;
  readonly meta: SaveMeta;
}
