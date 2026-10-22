import { Injectable } from '@angular/core';
import {
  CellCoord,
  DifficultyConfig,
  Direction,
  GridCell,
  PlacedWord,
} from '../models/word-puzzle.model';
import {
  DIRECTION_VECTORS,
  WORD_HIGHLIGHT_COLORS,
} from '../data/word-categories.data';

@Injectable({
  providedIn: 'root',
})
export class PuzzleGeneratorService {
  private readonly alphabet =
    'EEEEEEEEEEEEAAAAAAAIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGGBBCCMMPPFFHHVVWWYYKJXQZ';

  /**
   * Generates a complete Word Search grid and list of placed words,
   * ensuring a balanced mix of Horizontal, Vertical, and Diagonal placements.
   */
  generatePuzzle(
    candidateWords: string[],
    config: DifficultyConfig
  ): {
    grid: GridCell[][];
    placedWords: PlacedWord[];
  } {
    const { rows, cols, wordCount, allowedDirections } = config;
    const maxLen = Math.min(rows, cols);

    const validCandidates = candidateWords
      .map((w) => w.trim().toUpperCase().replace(/[^A-Z]/g, ''))
      .filter((w) => w.length >= 3 && w.length <= maxLen);

    const shuffled = this.shuffleArray([...validCandidates]);
    const pool = shuffled
      .slice(0, wordCount + 6)
      .sort((a, b) => b.length - a.length);

    const board: (string | null)[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => null)
    );

    const placedWords: PlacedWord[] = [];

    // Group directions into Horizontal, Vertical, and Diagonal buckets so every board has all 3
    const horizontalDirs = allowedDirections.filter(
      (d) => d === 'H' || d === 'H_REV'
    );
    const verticalDirs = allowedDirections.filter(
      (d) => d === 'V' || d === 'V_REV'
    );
    const diagonalDirs = allowedDirections.filter(
      (d) =>
        d === 'D_DOWN_RIGHT' ||
        d === 'D_DOWN_LEFT' ||
        d === 'D_UP_LEFT' ||
        d === 'D_UP_RIGHT'
    );

    const directionBuckets = [
      horizontalDirs,
      verticalDirs,
      diagonalDirs,
    ].filter((b) => b.length > 0);

    for (const word of pool) {
      if (placedWords.length >= wordCount) break;
      if (
        placedWords.some(
          (pw) => pw.word.includes(word) || word.includes(pw.word)
        )
      ) {
        continue;
      }

      // Rotate preferred direction bucket (H -> V -> Diagonal) to ensure all 3 orientations appear
      const preferredBucket =
        directionBuckets[placedWords.length % directionBuckets.length] ||
        allowedDirections;

      let placement = this.findBestPlacement(
        board,
        word,
        rows,
        cols,
        preferredBucket
      );
      if (!placement) {
        placement = this.findBestPlacement(
          board,
          word,
          rows,
          cols,
          allowedDirections
        );
      }

      if (placement) {
        const color =
          WORD_HIGHLIGHT_COLORS[
            placedWords.length % WORD_HIGHLIGHT_COLORS.length
          ];
        const cells: CellCoord[] = [];
        const vec = DIRECTION_VECTORS[placement.direction];

        for (let i = 0; i < word.length; i++) {
          const r = placement.row + vec.dRow * i;
          const c = placement.col + vec.dCol * i;
          board[r][c] = word[i];
          cells.push({ row: r, col: c });
        }

        const lastCell = cells[cells.length - 1];
        placedWords.push({
          word,
          startRow: placement.row,
          startCol: placement.col,
          endRow: lastCell.row,
          endCol: lastCell.col,
          direction: placement.direction,
          directionLabel: vec.label,
          cells,
          found: false,
          color,
          hintedCells: 0,
        });
      }
    }

    const grid: GridCell[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (__, c) => ({
        row: r,
        col: c,
        letter: board[r][c] ?? this.randomLetter(),
        isHinted: false,
        foundColors: [],
      }))
    );

    placedWords.sort((a, b) => a.word.localeCompare(b.word));

    return { grid, placedWords };
  }

  /**
   * Computes a straight horizontal, vertical, or 45-degree diagonal cell path
   * from start cell to target cell (with smart snapping when dragging).
   */
  getLineCells(
    start: CellCoord,
    end: CellCoord,
    maxRows: number,
    maxCols: number
  ): CellCoord[] {
    const dRow = end.row - start.row;
    const dCol = end.col - start.col;

    if (dRow === 0 && dCol === 0) {
      return [{ row: start.row, col: start.col }];
    }

    const absRow = Math.abs(dRow);
    const absCol = Math.abs(dCol);
    const distance = Math.max(absRow, absCol);

    const angle = Math.atan2(dRow, dCol) * (180 / Math.PI);
    const snappedAngle = Math.round(angle / 45) * 45;
    const rad = snappedAngle * (Math.PI / 180);

    const stepRow = Math.round(Math.sin(rad));
    const stepCol = Math.round(Math.cos(rad));

    const cells: CellCoord[] = [];
    for (let step = 0; step <= distance; step++) {
      const r = start.row + stepRow * step;
      const c = start.col + stepCol * step;
      if (r < 0 || r >= maxRows || c < 0 || c >= maxCols) {
        break;
      }
      cells.push({ row: r, col: c });
    }

    return cells;
  }

  private findBestPlacement(
    board: (string | null)[][],
    word: string,
    rows: number,
    cols: number,
    allowedDirections: Direction[]
  ): { row: number; col: number; direction: Direction } | null {
    interface Candidate {
      row: number;
      col: number;
      direction: Direction;
      overlaps: number;
    }

    const candidates: Candidate[] = [];
    const directions = this.shuffleArray([...allowedDirections]);

    for (const dir of directions) {
      const vec = DIRECTION_VECTORS[dir];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const endR = r + vec.dRow * (word.length - 1);
          const endC = c + vec.dCol * (word.length - 1);

          if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) {
            continue;
          }

          let fits = true;
          let overlaps = 0;

          for (let i = 0; i < word.length; i++) {
            const cellR = r + vec.dRow * i;
            const cellC = c + vec.dCol * i;
            const existing = board[cellR][cellC];
            if (existing !== null) {
              if (existing === word[i]) {
                overlaps++;
              } else {
                fits = false;
                break;
              }
            }
          }

          if (fits) {
            candidates.push({ row: r, col: c, direction: dir, overlaps });
          }
        }
      }
    }

    if (candidates.length === 0) return null;

    const overlapping = candidates.filter((cand) => cand.overlaps > 0);
    if (overlapping.length > 0 && Math.random() < 0.72) {
      return overlapping[Math.floor(Math.random() * overlapping.length)];
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private randomLetter(): string {
    const idx = Math.floor(Math.random() * this.alphabet.length);
    return this.alphabet[idx];
  }

  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
