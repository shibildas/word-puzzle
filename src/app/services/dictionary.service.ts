import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { DictionaryEntry, DictionaryMeaning } from '../models/word-puzzle.model';
import { FALLBACK_DEFINITIONS } from '../data/word-categories.data';

interface RawDictionaryApiResponse {
  word: string;
  phonetic?: string;
  phonetics?: {
    text?: string;
    audio?: string;
  }[];
  meanings?: {
    partOfSpeech?: string;
    definitions?: {
      definition: string;
      example?: string;
    }[];
    synonyms?: string[];
  }[];
}

const DICT_CACHE_STORAGE_KEY = 'word_puzzle_dictionary_cache_v1';

@Injectable({
  providedIn: 'root',
})
export class DictionaryService {
  private readonly proxyBaseUrl = '/api/v2/entries/en';
  private readonly directApiBaseUrl = 'https://api.dictionaryapi.dev/api/v2/entries/en';
  private memoryCache = new Map<string, DictionaryEntry>();

  constructor(private http: HttpClient) {
    this.loadCacheFromStorage();
  }

  /**
   * Look up a word via the CORS-safe dev-server proxy (/api/v2/entries/en/{word}),
   * with fallback to direct HTTPS API and local dictionary cache.
   */
  getWordDefinition(word: string): Observable<DictionaryEntry> {
    const normalized = word.trim().toUpperCase();
    const cached = this.memoryCache.get(normalized);
    if (cached && cached.loadedFromApi) {
      return of(cached);
    }

    const encodedWord = encodeURIComponent(normalized.toLowerCase());
    const proxyUrl = `${this.proxyBaseUrl}/${encodedWord}`;
    const directUrl = `${this.directApiBaseUrl}/${encodedWord}`;

    return this.http.get<RawDictionaryApiResponse[]>(proxyUrl).pipe(
      catchError(() => this.http.get<RawDictionaryApiResponse[]>(directUrl)),
      map((res) => this.transformApiResponse(normalized, res)),
      tap((entry) => {
        this.memoryCache.set(normalized, entry);
        this.saveCacheToStorage();
      }),
      catchError(() => {
        const fallback = this.buildFallbackEntry(normalized);
        this.memoryCache.set(normalized, fallback);
        return of(fallback);
      })
    );
  }

  /**
   * Prefetch a list of puzzle words in the background so definitions and clue hints
   * are ready immediately during gameplay.
   */
  prefetchWords(words: string[]): void {
    words.forEach((word) => {
      const normalized = word.trim().toUpperCase();
      if (!this.memoryCache.has(normalized)) {
        this.getWordDefinition(normalized).subscribe();
      }
    });
  }

  /**
   * Synchronously get a cached entry if already loaded.
   */
  getCachedEntry(word: string): DictionaryEntry | undefined {
    return this.memoryCache.get(word.trim().toUpperCase());
  }

  private transformApiResponse(word: string, data: RawDictionaryApiResponse[]): DictionaryEntry {
    if (!Array.isArray(data) || data.length === 0) {
      return this.buildFallbackEntry(word);
    }

    const first = data[0];
    let phonetic = first.phonetic || '';
    let audioUrl = '';

    if (Array.isArray(first.phonetics)) {
      for (const p of first.phonetics) {
        if (!phonetic && p.text) {
          phonetic = p.text;
        }
        if (!audioUrl && p.audio && p.audio.trim().length > 0) {
          audioUrl = p.audio.trim();
        }
      }
    }

    const meanings: DictionaryMeaning[] = (first.meanings || []).map((m) => ({
      partOfSpeech: m.partOfSpeech || 'noun',
      definitions: (m.definitions || []).slice(0, 3).map((d) => ({
        definition: d.definition,
        example: d.example,
      })),
      synonyms: (m.synonyms || []).slice(0, 5),
    }));

    const primaryMeaning = meanings[0];
    const primaryDefObj = primaryMeaning?.definitions?.[0];

    return {
      word,
      phonetic: phonetic || undefined,
      audioUrl: audioUrl || undefined,
      primaryPartOfSpeech: primaryMeaning?.partOfSpeech || 'word',
      primaryDefinition:
        primaryDefObj?.definition ||
        FALLBACK_DEFINITIONS[word] ||
        `An English word ("${word.toLowerCase()}") hidden in the puzzle grid.`,
      primaryExample: primaryDefObj?.example,
      meanings,
      loadedFromApi: true,
    };
  }

  private buildFallbackEntry(word: string): DictionaryEntry {
    const def =
      FALLBACK_DEFINITIONS[word] ||
      `Hidden puzzle word (${word.length} letters). Connect the letters in a straight line to capture it!`;
    return {
      word,
      primaryPartOfSpeech: 'noun',
      primaryDefinition: def,
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [{ definition: def }],
        },
      ],
      loadedFromApi: false,
    };
  }

  private loadCacheFromStorage(): void {
    try {
      const raw = localStorage.getItem(DICT_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed: Record<string, DictionaryEntry> = JSON.parse(raw);
      Object.entries(parsed).forEach(([k, v]) => {
        this.memoryCache.set(k, v);
      });
    } catch {
      // Ignore corrupt cache
    }
  }

  private saveCacheToStorage(): void {
    try {
      const entries = Array.from(this.memoryCache.entries()).slice(-150);
      const obj: Record<string, DictionaryEntry> = {};
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      localStorage.setItem(DICT_CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Ignore storage quota errors
    }
  }
}
