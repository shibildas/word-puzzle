import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CellCoord,
  DictionaryEntry,
  DifficultyConfig,
  DifficultyId,
  GridCell,
  LevelRecord,
  PlacedWord,
  PlayerStats,
  ScoreHistoryEntry,
  WordCategory,
} from './models/word-puzzle.model';
import {
  DIFFICULTY_CONFIGS,
  FALLBACK_DEFINITIONS,
  WORD_CATEGORIES,
} from './data/word-categories.data';
import { PuzzleGeneratorService } from './services/puzzle-generator.service';
import { DictionaryService } from './services/dictionary.service';
import { StorageService } from './services/storage.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly title = 'Word Search Puzzle';

  @ViewChild('gridContainer') gridContainerRef?: ElementRef<HTMLDivElement>;

  // Configurations & Static Data
  readonly categories: WordCategory[] = WORD_CATEGORIES;
  readonly difficulties: DifficultyConfig[] = Object.values(DIFFICULTY_CONFIGS);

  // Active Game Configuration
  currentLevelNumber = 1;
  selectedCategoryId = WORD_CATEGORIES[0].id;
  selectedDifficultyId: DifficultyId = 'easy';
  clueMode = true; // Default ON: masks unfound words and gives dictionary definition as clue

  // Board State
  grid: GridCell[][] = [];
  placedWords: PlacedWord[] = [];

  // Selection State (supports both drag and click-to-select)
  isDragging = false;
  clickAnchored = false;
  selectionStart: CellCoord | null = null;
  selectionEnd: CellCoord | null = null;
  selectedCells: CellCoord[] = [];
  selectedWordPreview = '';
  lastCaptureStatus: 'none' | 'found' | 'already' | 'miss' = 'none';

  // Timer, Score, & Hints
  elapsedSec = 0;
  isPaused = false;
  isGameComplete = false;
  score = 0;
  hintsRemaining = 5;
  hintsUsed = 0;
  wordStreak = 0;
  lastEarnedPoints = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  // Dictionary API State (https://api.dictionaryapi.dev/api/v2)
  activeDictionaryWord: PlacedWord | null = null;
  activeDictionaryEntry: DictionaryEntry | null = null;
  isLoadingDictionary = false;
  private currentAudio: HTMLAudioElement | null = null;

  // Persistent Data & UI Modals
  levels: LevelRecord[] = [];
  playerStats!: PlayerStats;
  scoreHistory: ScoreHistoryEntry[] = [];
  scoreFilterDifficulty: DifficultyId | 'all' = 'all';

  activeModal: 'none' | 'levels' | 'scores' | 'victory' = 'none';
  victoryStars = 3;

  constructor(
    private puzzleGenerator: PuzzleGeneratorService,
    private dictionaryService: DictionaryService,
    private storageService: StorageService
  ) {}

  ngOnInit(): void {
    this.levels = this.storageService.getLevels();
    this.playerStats = this.storageService.getStats();
    this.scoreHistory = this.storageService.getScoreHistory();

    // Restore active saved game if available
    const saved = this.storageService.getActiveGame();
    if (
      saved &&
      saved.grid?.length > 0 &&
      saved.placedWords?.some((w) => !w.found)
    ) {
      this.currentLevelNumber = saved.levelNumber;
      this.selectedCategoryId = saved.categoryId;
      this.selectedDifficultyId = saved.difficulty;
      this.grid = saved.grid;
      this.placedWords = saved.placedWords;
      this.elapsedSec = saved.elapsedSec;
      this.score = saved.score;
      this.hintsRemaining = saved.hintsRemaining;
      this.hintsUsed = saved.hintsUsed;
      this.wordStreak = saved.streakCount || 0;
      this.startTimer();
      this.prefetchCurrentWords();
      // Select first word for dictionary panel
      if (this.placedWords.length > 0) {
        this.inspectWord(this.placedWords[0]);
      }
    } else {
      // Start at highest unlocked level
      const currentLvl =
        this.levels.find((l) => l.levelNumber === this.playerStats.currentLevel) ||
        this.levels[0];
      this.startLevel(currentLvl.levelNumber);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  // Computed getters
  get currentCategory(): WordCategory {
    return (
      this.categories.find((c) => c.id === this.selectedCategoryId) ||
      this.categories[0]
    );
  }

  get currentDifficulty(): DifficultyConfig {
    return (
      DIFFICULTY_CONFIGS[this.selectedDifficultyId] || DIFFICULTY_CONFIGS['easy']
    );
  }

  get foundWordsCount(): number {
    return this.placedWords.filter((w) => w.found).length;
  }

  get progressPercentage(): number {
    if (this.placedWords.length === 0) return 0;
    return Math.round((this.foundWordsCount / this.placedWords.length) * 100);
  }

  get filteredScoreHistory(): ScoreHistoryEntry[] {
    const list =
      this.scoreFilterDifficulty === 'all'
        ? this.scoreHistory
        : this.scoreHistory.filter(
            (s) => s.difficulty === this.scoreFilterDifficulty
          );
    return [...list].sort((a, b) => b.score - a.score);
  }

  get formattedTimer(): string {
    return this.formatSeconds(this.elapsedSec);
  }

  formatSeconds(totalSec: number | null): string {
    if (totalSec === null || totalSec === undefined) return '--:--';
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  // Game Setup & Level Navigation
  startLevel(levelNumber: number): void {
    const level = this.levels.find((l) => l.levelNumber === levelNumber);
    if (!level || !level.unlocked) return;

    this.currentLevelNumber = level.levelNumber;
    this.selectedCategoryId = level.categoryId;
    this.selectedDifficultyId = level.difficulty;
    this.activeModal = 'none';
    this.startNewPuzzle();
  }

  onCategoryChange(categoryId: string): void {
    this.selectedCategoryId = categoryId;
    this.startNewPuzzle();
  }

  onDifficultyChange(difficultyId: DifficultyId): void {
    this.selectedDifficultyId = difficultyId;
    this.startNewPuzzle();
  }

  startNewPuzzle(): void {
    this.stopTimer();
    const config = this.currentDifficulty;
    const category = this.currentCategory;

    const { grid, placedWords } = this.puzzleGenerator.generatePuzzle(
      category.words,
      config
    );

    this.grid = grid;
    this.placedWords = placedWords;
    this.elapsedSec = 0;
    this.score = 0;
    this.hintsRemaining = config.maxHints;
    this.hintsUsed = 0;
    this.wordStreak = 0;
    this.lastEarnedPoints = 0;
    this.isPaused = false;
    this.isGameComplete = false;
    this.clearSelection();
    this.activeModal = 'none';

    this.prefetchCurrentWords();
    if (this.placedWords.length > 0) {
      this.inspectWord(this.placedWords[0]);
    }

    this.startTimer();
    this.persistActiveGame();
  }

  nextLevel(): void {
    const nextNum = this.currentLevelNumber + 1;
    const nextLvl = this.levels.find((l) => l.levelNumber === nextNum);
    if (nextLvl && nextLvl.unlocked) {
      this.startLevel(nextNum);
    } else {
      this.startNewPuzzle();
    }
  }

  // Selection Mechanics (Drag & Click-to-Select)
  onCellPointerDown(row: number, col: number, event: PointerEvent): void {
    if (this.isPaused || this.isGameComplete) return;
    event.preventDefault();

    // If user previously anchored a start cell via click, clicking a second cell completes selection
    if (
      this.clickAnchored &&
      this.selectionStart &&
      (this.selectionStart.row !== row || this.selectionStart.col !== col)
    ) {
      this.updateSelectionPath({ row, col });
      this.finalizeSelection();
      return;
    }

    this.isDragging = true;
    this.clickAnchored = true;
    this.selectionStart = { row, col };
    this.selectionEnd = { row, col };
    this.updateSelectionPath({ row, col });
  }

  onCellPointerEnter(row: number, col: number): void {
    if (this.isPaused || this.isGameComplete) return;
    if ((this.isDragging || this.clickAnchored) && this.selectionStart) {
      this.updateSelectionPath({ row, col });
    }
  }

  onGridTouchMove(event: TouchEvent): void {
    if (!this.isDragging || !this.selectionStart || this.isPaused || this.isGameComplete) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const elem = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    const cellEl = elem?.closest('[data-row][data-col]') as HTMLElement | null;
    if (cellEl) {
      const r = Number(cellEl.getAttribute('data-row'));
      const c = Number(cellEl.getAttribute('data-col'));
      if (!Number.isNaN(r) && !Number.isNaN(c)) {
        event.preventDefault();
        this.updateSelectionPath({ row: r, col: c });
      }
    }
  }

  @HostListener('window:pointerup')
  onGlobalPointerUp(): void {
    if (!this.isDragging) return;
    this.isDragging = false;

    // If the user dragged across 2+ cells, finalize immediately.
    // If they just clicked a single cell, keep `clickAnchored = true` so they can click the end cell!
    if (this.selectedCells.length > 1) {
      this.finalizeSelection();
    }
  }

  @HostListener('window:keydown.escape')
  onEscapeKey(): void {
    this.clearSelection();
    if (this.activeModal !== 'none' && this.activeModal !== 'victory') {
      this.activeModal = 'none';
    }
  }

  private updateSelectionPath(target: CellCoord): void {
    if (!this.selectionStart) return;
    const rows = this.grid.length;
    const cols = this.grid[0]?.length || 0;

    this.selectedCells = this.puzzleGenerator.getLineCells(
      this.selectionStart,
      target,
      rows,
      cols
    );
    if (this.selectedCells.length > 0) {
      this.selectionEnd = this.selectedCells[this.selectedCells.length - 1];
    }
    this.selectedWordPreview = this.selectedCells
      .map((c) => this.grid[c.row][c.col].letter)
      .join('');
  }

  private finalizeSelection(): void {
    if (this.selectedCells.length < 2) {
      this.clearSelection();
      return;
    }

    const forwardWord = this.selectedWordPreview;
    const reverseWord = forwardWord.split('').reverse().join('');

    // Match against placedWords
    const matched = this.placedWords.find(
      (pw) =>
        (pw.word === forwardWord || pw.word === reverseWord) &&
        this.cellsMatchWord(this.selectedCells, pw.cells)
    );

    if (matched) {
      if (matched.found) {
        this.lastCaptureStatus = 'already';
        this.inspectWord(matched);
      } else {
        this.markWordFound(matched);
      }
    } else {
      this.lastCaptureStatus = 'miss';
      this.wordStreak = 0;
    }

    this.clearSelection();
  }

  private cellsMatchWord(selected: CellCoord[], target: CellCoord[]): boolean {
    if (selected.length !== target.length) return false;
    const forwardMatch = selected.every(
      (cell, idx) => cell.row === target[idx].row && cell.col === target[idx].col
    );
    if (forwardMatch) return true;

    const len = target.length;
    return selected.every(
      (cell, idx) =>
        cell.row === target[len - 1 - idx].row &&
        cell.col === target[len - 1 - idx].col
    );
  }

  private markWordFound(wordObj: PlacedWord): void {
    wordObj.found = true;
    wordObj.foundAtSec = this.elapsedSec;
    this.lastCaptureStatus = 'found';
    this.wordStreak += 1;

    // Color cells on the grid
    for (const coord of wordObj.cells) {
      const cell = this.grid[coord.row][coord.col];
      if (!cell.foundColors.includes(wordObj.color)) {
        cell.foundColors.push(wordObj.color);
      }
      cell.isHinted = false;
    }

    // Calculate score with length, difficulty multiplier, and streak bonus
    const config = this.currentDifficulty;
    const base = config.basePointsPerWord + wordObj.word.length * 15;
    const streakBonus = (this.wordStreak - 1) * 25;
    const hintPenalty = wordObj.hintedCells * 25;
    const earned = Math.max(
      50,
      Math.round((base + streakBonus - hintPenalty) * config.multiplier)
    );

    this.lastEarnedPoints = earned;
    this.score += earned;

    // Automatically inspect the found word in the Dictionary API panel
    this.inspectWord(wordObj);

    if (this.foundWordsCount === this.placedWords.length) {
      this.handlePuzzleVictory();
    } else {
      this.persistActiveGame();
    }
  }

  clearSelection(): void {
    this.isDragging = false;
    this.clickAnchored = false;
    this.selectionStart = null;
    this.selectionEnd = null;
    this.selectedCells = [];
    this.selectedWordPreview = '';
  }

  isCellSelected(row: number, col: number): boolean {
    return this.selectedCells.some((c) => c.row === row && c.col === col);
  }

  // SVG Line Coordinates (0 to 100 viewBox percentage)
  getWordLineCoords(word: PlacedWord): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } {
    const rows = this.grid.length || 1;
    const cols = this.grid[0]?.length || 1;
    return {
      x1: ((word.startCol + 0.5) / cols) * 100,
      y1: ((word.startRow + 0.5) / rows) * 100,
      x2: ((word.endCol + 0.5) / cols) * 100,
      y2: ((word.endRow + 0.5) / rows) * 100,
    };
  }

  getActiveSelectionLineCoords(): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null {
    if (!this.selectionStart || !this.selectionEnd || this.selectedCells.length === 0) {
      return null;
    }
    const rows = this.grid.length || 1;
    const cols = this.grid[0]?.length || 1;
    return {
      x1: ((this.selectionStart.col + 0.5) / cols) * 100,
      y1: ((this.selectionStart.row + 0.5) / rows) * 100,
      x2: ((this.selectionEnd.col + 0.5) / cols) * 100,
      y2: ((this.selectionEnd.row + 0.5) / rows) * 100,
    };
  }

  getSvgStrokeWidth(): number {
    const cols = this.grid[0]?.length || 10;
    return (100 / cols) * 0.68;
  }

  // Hint System
  useHint(): void {
    if (this.hintsRemaining <= 0 || this.isPaused || this.isGameComplete) {
      return;
    }

    const unfound = this.placedWords.filter((w) => !w.found);
    if (unfound.length === 0) return;

    // Prioritize currently inspected unfound word, or pick the first unfound word
    let target =
      this.activeDictionaryWord && !this.activeDictionaryWord.found
        ? this.activeDictionaryWord
        : unfound[0];

    const cellIndexToReveal = Math.min(
      target.hintedCells,
      target.cells.length - 1
    );
    const coord = target.cells[cellIndexToReveal];
    this.grid[coord.row][coord.col].isHinted = true;
    target.hintedCells += 1;

    this.hintsRemaining -= 1;
    this.hintsUsed += 1;

    // Also load its dictionary definition to help the player
    this.inspectWord(target);
    this.persistActiveGame();
  }

  // Dictionary API Integration (https://api.dictionaryapi.dev/api/v2)
  inspectWord(wordObj: PlacedWord): void {
    this.activeDictionaryWord = wordObj;
    const cached = this.dictionaryService.getCachedEntry(wordObj.word);
    if (cached) {
      this.activeDictionaryEntry = cached;
      this.isLoadingDictionary = false;
      return;
    }

    this.isLoadingDictionary = true;
    this.dictionaryService.getWordDefinition(wordObj.word).subscribe((entry) => {
      if (this.activeDictionaryWord?.word === wordObj.word) {
        this.activeDictionaryEntry = entry;
        this.isLoadingDictionary = false;
      }
    });
  }

  playWordAudio(audioUrl?: string): void {
    if (!audioUrl) return;
    try {
      if (this.currentAudio) {
        this.currentAudio.pause();
      }
      this.currentAudio = new Audio(audioUrl);
      this.currentAudio.play().catch(() => {
        // Ignore autoplay restrictions
      });
    } catch {
      // Ignore audio errors
    }
  }

  getMaskedWord(wordObj: PlacedWord): string {
    if (wordObj.found || !this.clueMode) {
      return wordObj.word;
    }
    return wordObj.word
      .split('')
      .map((ch, idx) =>
        idx === 0 || idx === wordObj.word.length - 1 || idx < wordObj.hintedCells
          ? ch
          : '•'
      )
      .join(' ');
  }

  getQuickClue(word: string): string {
    const normalized = word.trim().toUpperCase();
    const entry = this.dictionaryService.getCachedEntry(normalized);
    return (
      entry?.primaryDefinition ||
      FALLBACK_DEFINITIONS[normalized] ||
      'Connect the letters horizontally, vertically, or diagonally to find this word.'
    );
  }

  private prefetchCurrentWords(): void {
    const words = this.placedWords.map((w) => w.word);
    this.dictionaryService.prefetchWords(words);
  }

  // Timer & Victory Handling
  togglePause(): void {
    if (this.isGameComplete) return;
    this.isPaused = !this.isPaused;
    this.clearSelection();
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      if (!this.isPaused && !this.isGameComplete) {
        this.elapsedSec += 1;
        if (this.elapsedSec % 5 === 0) {
          this.persistActiveGame();
        }
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private handlePuzzleVictory(): void {
    this.isGameComplete = true;
    this.stopTimer();

    const config = this.currentDifficulty;
    // Time bonus calculation
    const secondsUnderTarget = Math.max(
      0,
      config.timeBonusThresholdSec - this.elapsedSec
    );
    const timeBonus = Math.round(secondsUnderTarget * 3 * config.multiplier);
    this.score += timeBonus;

    // Determine Star Rating (1 to 3 stars)
    let stars = 3;
    if (
      this.elapsedSec > config.timeBonusThresholdSec * 1.4 ||
      this.hintsUsed >= 3
    ) {
      stars = 1;
    } else if (
      this.elapsedSec > config.timeBonusThresholdSec ||
      this.hintsUsed >= 1
    ) {
      stars = 2;
    }
    this.victoryStars = stars;

    const updated = this.storageService.recordLevelCompletion({
      levelNumber: this.currentLevelNumber,
      categoryName: this.currentCategory.name,
      difficulty: this.selectedDifficultyId,
      gridSize: `${config.rows}×${config.cols}`,
      score: this.score,
      timeSec: this.elapsedSec,
      wordsFound: this.placedWords.length,
      totalWords: this.placedWords.length,
      hintsUsed: this.hintsUsed,
      stars,
    });

    this.levels = updated.levels;
    this.playerStats = updated.stats;
    this.scoreHistory = updated.history;
    this.activeModal = 'victory';
  }

  private persistActiveGame(): void {
    if (this.isGameComplete) return;
    this.storageService.saveActiveGame({
      levelNumber: this.currentLevelNumber,
      categoryId: this.selectedCategoryId,
      difficulty: this.selectedDifficultyId,
      grid: this.grid,
      placedWords: this.placedWords,
      elapsedSec: this.elapsedSec,
      score: this.score,
      hintsRemaining: this.hintsRemaining,
      hintsUsed: this.hintsUsed,
      streakCount: this.wordStreak,
      savedAtIso: new Date().toISOString(),
    });
  }

  getCategoryById(id: string): WordCategory {
    return this.categories.find((c) => c.id === id) || this.categories[0];
  }

  resetAllSavedData(): void {
    this.storageService.resetAllProgress();
    this.levels = this.storageService.getLevels();
    this.playerStats = this.storageService.getStats();
    this.scoreHistory = this.storageService.getScoreHistory();
    this.startLevel(1);
  }
}
