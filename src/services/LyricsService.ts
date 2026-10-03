import { logger } from '../utils/logger';

const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_CACHE_ENTRIES = 500;

export interface LyricsTrackMetadata {
  title: string;
  artist: string;
  durationMs: number;
}

export interface LyricsResult {
  id?: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

interface CacheEntry {
  value: LyricsResult | null;
  expiresAt: number;
}

export class LyricsRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super('LRCLIB rate limit reached');
    this.name = 'LyricsRateLimitError';
  }
}

export class LyricsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<LyricsResult | null>>();

  constructor(
    private readonly baseUrl = process.env.LYRICS_API_URL || 'https://lrclib.net',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async getLyrics(metadata: LyricsTrackMetadata): Promise<LyricsResult | null> {
    const key = `${normalizeText(metadata.title)}|${normalizeText(metadata.artist)}|${Math.round(metadata.durationMs / 1000)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    if (cached) this.cache.delete(key);

    const active = this.inflight.get(key);
    if (active) return active;

    const request = this.lookup(metadata)
      .then((result) => {
        this.setCache(key, result, result ? HIT_TTL_MS : MISS_TTL_MS);
        return result;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private async lookup(metadata: LyricsTrackMetadata): Promise<LyricsResult | null> {
    const duration = Math.max(0, Math.round(metadata.durationMs / 1000));
    const attempts = [
      { title: metadata.title, artist: metadata.artist },
      { title: normalizeTrackTitle(metadata.title), artist: normalizeArtist(metadata.artist) },
    ].filter((value, index, values) => index === 0
      || value.title !== values[0].title
      || value.artist !== values[0].artist);

    for (const attempt of attempts) {
      const exact = await this.request<LyricsResult>('/api/get', {
        track_name: attempt.title,
        artist_name: attempt.artist,
        duration: String(duration),
      }, true);
      if (exact) return exact;
    }

    const normalizedTitle = normalizeTrackTitle(metadata.title);
    const normalizedArtist = normalizeArtist(metadata.artist);
    const results = await this.request<LyricsResult[]>('/api/search', {
      track_name: normalizedTitle,
      artist_name: normalizedArtist,
    }, false) || [];
    return chooseBestResult(results, normalizedTitle, normalizedArtist, duration);
  }

  private async request<T>(path: string, query: Record<string, string>, allowNotFound: boolean): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(path, this.baseUrl);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const response = await this.fetcher(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'WonderplayMusic/1.0.0 (https://github.com/RoxyEmanuel26/wonderplay-bot-Music-discord)',
          Accept: 'application/json',
        },
      });
      if (response.status === 404 && allowNotFound) return null;
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : null;
        throw new LyricsRateLimitError(seconds);
      }
      if (!response.ok) throw new Error(`LRCLIB returned HTTP ${response.status}`);
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private setCache(key: string, value: LyricsResult | null, ttl: number) {
    this.cache.set(key, { value, expiresAt: Date.now() + ttl });
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

export function normalizeTrackTitle(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s*[[(][^[\]()]*(?:official|video|audio|lyrics?|mv|sped\s*up|slowed|reverb|cover)[^[\]()]*(?:\]|\))\s*/gi, ' ')
    .replace(/\s+(?:official\s+(?:video|audio)|lyrics?(?:\s+video)?)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArtist(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+-\s+Topic\s*$/i, '')
    .replace(/\bVEVO\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripSyncedTimestamps(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^(?:\[(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.:]\d{1,3})?])+\s*/, '').trimEnd())
    .join('\n')
    .trim();
}

export function splitLyrics(value: string, maxLength = 3800): string[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const pages: string[] = [];
  let page = '';
  for (const originalLine of lines) {
    let line = originalLine;
    while (line.length > maxLength) {
      if (page) {
        pages.push(page);
        page = '';
      }
      pages.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }
    const candidate = page ? `${page}\n${line}` : line;
    if (candidate.length > maxLength) {
      pages.push(page);
      page = line;
    } else {
      page = candidate;
    }
  }
  if (page || pages.length === 0) pages.push(page);
  return pages;
}

function chooseBestResult(
  results: LyricsResult[],
  title: string,
  artist: string,
  durationSeconds: number,
): LyricsResult | null {
  const titleTokens = tokens(title);
  const artistTokens = tokens(artist);
  const ranked = results.map((result) => {
    const titleScore = overlap(titleTokens, tokens(result.trackName));
    const artistScore = overlap(artistTokens, tokens(result.artistName));
    const durationDelta = result.duration && durationSeconds ? Math.abs(result.duration - durationSeconds) : 0;
    const durationScore = durationDelta <= 3 ? 1 : durationDelta <= 10 ? 0.5 : durationDelta <= 30 ? 0.1 : 0;
    return { result, score: titleScore * 0.6 + artistScore * 0.3 + durationScore * 0.1, durationDelta };
  }).sort((a, b) => b.score - a.score || a.durationDelta - b.durationDelta);

  const best = ranked[0];
  if (!best || best.score < 0.42) {
    logger.debug({ title, artist, candidates: results.length }, 'LRCLIB search did not produce a confident match');
    return null;
  }
  return best.result;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function overlap(expected: Set<string>, actual: Set<string>): number {
  if (expected.size === 0) return 0;
  let matched = 0;
  for (const token of expected) if (actual.has(token)) matched++;
  return matched / expected.size;
}

export const lyricsService = new LyricsService();
