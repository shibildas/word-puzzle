import { Injectable } from '@angular/core';
import {
  DifficultyId,
  LevelRecord,
  PlayerStats,
  SavedActiveGame,
  ScoreHistoryEntry,
} from '../models/word-puzzle.model';
import { WORD_CATEGORIES } from '../data/word-categories.data';

const STORAGE_KEYS = {
  LEVELS: 'word_puzzle_levels_v1',
  SCORES: 'word_puzzle_scores_v1',
  STATS: 'word_puzzle_stats_v1',
  ACTIVE_GAME: 'word_puzzle_active_game_v2',
};

const TOTAL_CAMPAIGN_LEVELS = 24;

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  getLevels(): LevelRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LEVELS);
      if (raw) {
        const parsed: LevelRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === TOTAL_CAMPAIGN_LEVELS) {
          return parsed;
        }
      }
    } catch {
      // Fallback to default levels
    }
    const initial = this.buildDefaultLevels();
    this.saveLevels(initial);
    return initial;
  }

  saveLevels(levels: LevelRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LEVELS, JSON.stringify(levels));
    } catch {
      // Ignore storage errors
    }
  }

  getStats(): PlayerStats {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STATS);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Fallback
    }
    const defaults: PlayerStats = {
      totalScore: 0,
      gamesCompleted: 0,
      totalWordsFound: 0,
      currentStreak: 0,
      bestStreak: 0,
      fastestWinSec: null,
      currentLevel: 1,
    };
    this.saveStats(defaults);
    return defaults;
  }

  saveStats(stats: PlayerStats): void {
    try {
      localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats));
    } catch {
      // Ignore storage errors
    }
  }

  getScoreHistory(): ScoreHistoryEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SCORES);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Fallback
    }
    return [];
  }

  addScoreEntry(entry: ScoreHistoryEntry): ScoreHistoryEntry[] {
    const history = this.getScoreHistory();
    const updated = [entry, ...history].slice(0, 100);
    try {
      localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(updated));
    } catch {
      // Ignore
    }
    return updated;
  }

  recordLevelCompletion(params: {
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
  }): {
    levels: LevelRecord[];
    stats: PlayerStats;
    history: ScoreHistoryEntry[];
  } {
    const levels = this.getLevels();
    const idx = levels.findIndex((l) => l.levelNumber === params.levelNumber);

    if (idx !== -1) {
      const current = levels[idx];
      current.completed = true;
      current.timesPlayed += 1;
      if (params.score > current.bestScore) {
        current.bestScore = params.score;
      }
      if (current.bestTimeSec === null || params.timeSec < current.bestTimeSec) {
        current.bestTimeSec = params.timeSec;
      }
      if (params.stars > current.stars) {
        current.stars = params.stars;
      }

      // Unlock next level
      if (idx + 1 < levels.length) {
        levels[idx + 1].unlocked = true;
      }
      this.saveLevels(levels);
    }

    const stats = this.getStats();
    stats.totalScore += params.score;
    stats.gamesCompleted += 1;
    stats.totalWordsFound += params.wordsFound;
    stats.currentStreak += 1;
    if (stats.currentStreak > stats.bestStreak) {
      stats.bestStreak = stats.currentStreak;
    }
    if (stats.fastestWinSec === null || params.timeSec < stats.fastestWinSec) {
      stats.fastestWinSec = params.timeSec;
    }
    const highestUnlocked = levels.filter((l) => l.unlocked).pop();
    if (highestUnlocked) {
      stats.currentLevel = highestUnlocked.levelNumber;
    }
    this.saveStats(stats);

    const history = this.addScoreEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dateIso: new Date().toISOString(),
      levelNumber: params.levelNumber,
      categoryName: params.categoryName,
      difficulty: params.difficulty,
      gridSize: params.gridSize,
      score: params.score,
      timeSec: params.timeSec,
      wordsFound: params.wordsFound,
      totalWords: params.totalWords,
      hintsUsed: params.hintsUsed,
      stars: params.stars,
    });

    this.clearActiveGame();
    return { levels, stats, history };
  }

  saveActiveGame(game: SavedActiveGame): void {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_GAME, JSON.stringify(game));
    } catch {
      // Ignore
    }
  }

  getActiveGame(): SavedActiveGame | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  clearActiveGame(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_GAME);
    } catch {
      // Ignore
    }
  }

  resetAllProgress(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.LEVELS);
      localStorage.removeItem(STORAGE_KEYS.SCORES);
      localStorage.removeItem(STORAGE_KEYS.STATS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_GAME);
    } catch {
      // Ignore
    }
  }

  private buildDefaultLevels(): LevelRecord[] {
    const difficulties: DifficultyId[] = ['easy', 'medium', 'hard', 'expert'];
    const levels: LevelRecord[] = [];

    for (let i = 0; i < TOTAL_CAMPAIGN_LEVELS; i++) {
      const levelNumber = i + 1;
      const category = WORD_CATEGORIES[i % WORD_CATEGORIES.length];
      // Gradually increase difficulty across the 24 levels
      let difficulty: DifficultyId = 'easy';
      if (levelNumber > 16) {
        difficulty = 'expert';
      } else if (levelNumber > 10) {
        difficulty = 'hard';
      } else if (levelNumber > 4) {
        difficulty = 'medium';
      } else {
        difficulty = difficulties[0];
      }

      levels.push({
        levelNumber,
        categoryId: category.id,
        difficulty,
        unlocked: levelNumber === 1,
        completed: false,
        bestScore: 0,
        bestTimeSec: null,
        stars: 0,
        timesPlayed: 0,
      });
    }

    return levels;
  }
}
