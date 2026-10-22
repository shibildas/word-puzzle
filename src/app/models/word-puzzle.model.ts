export type Direction =
  | 'H'            // Horizontal left-to-right (0, +1)
  | 'H_REV'        // Horizontal backward right-to-left (0, -1)
  | 'V'            // Vertical top-to-bottom (+1, 0)
  | 'V_REV'        // Vertical backward bottom-to-top (-1, 0)
  | 'D_DOWN_RIGHT' // Diagonal top-left to bottom-right (+1, +1)
  | 'D_UP_LEFT'    // Diagonal backward bottom-right to top-left (-1, -1)
  | 'D_DOWN_LEFT'  // Diagonal top-right to bottom-left (+1, -1)
  | 'D_UP_RIGHT';  // Diagonal backward bottom-left to top-right (-1, +1)

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'expert';

export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  subtitle: string;
  rows: number;
  cols: number;
  wordCount: number;
  allowedDirections: Direction[];
  basePointsPerWord: number;
  timeBonusThresholdSec: number;
  maxHints: number;
  multiplier: number;
}

export interface WordCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  words: string[];
}

export interface CellCoord {
  row: number;
  col: number;
}

export interface GridCell {
  row: number;
  col: number;
  letter: string;
  isHinted: boolean;
  foundColors: string[];
}

export interface PlacedWord {
  word: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  direction: Direction;
  directionLabel: string;
  cells: CellCoord[];
  found: boolean;
  color: string;
  hintedCells: number;
  foundAtSec?: number;
}

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: {
    definition: string;
    example?: string;
  }[];
  synonyms?: string[];
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  audioUrl?: string;
  primaryPartOfSpeech?: string;
  primaryDefinition: string;
  primaryExample?: string;
  meanings: DictionaryMeaning[];
  loadedFromApi: boolean;
}

export interface LevelRecord {
  levelNumber: number;
  categoryId: string;
  difficulty: DifficultyId;
  unlocked: boolean;
  completed: boolean;
  bestScore: number;
  bestTimeSec: number | null;
  stars: number; // 0 to 3
  timesPlayed: number;
}

export interface ScoreHistoryEntry {
  id: string;
  dateIso: string;
  levelNumber: number;
  categoryName: string;
  difficulty: DifficultyId;
  gridSize: string;
  score: number;
  timeSec: number;
  wordsFound: number;
  totalWords: number;
  hintsUsed: number;
  stars: number;
}

export interface PlayerStats {
  totalScore: number;
  gamesCompleted: number;
  totalWordsFound: number;
  currentStreak: number;
  bestStreak: number;
  fastestWinSec: number | null;
  currentLevel: number;
}

export interface SavedActiveGame {
  levelNumber: number;
  categoryId: string;
  difficulty: DifficultyId;
  grid: GridCell[][];
  placedWords: PlacedWord[];
  elapsedSec: number;
  score: number;
  hintsRemaining: number;
  hintsUsed: number;
  streakCount: number;
  savedAtIso: string;
}
