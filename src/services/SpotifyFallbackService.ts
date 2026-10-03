import { Track } from 'shoukaku';
import type { AureliaClient } from '../structures/AureliaClient';
import { logger } from '../utils/logger';

export type SpotifyEntity = 'track' | 'album' | 'playlist';

export interface SpotifyReference {
  type: SpotifyEntity;
  id: string;
  url: string;
}

interface SpotifyOEmbed {
  title: string;
  thumbnail_url?: string;
}

interface SpotifyApiTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  is_local?: boolean;
  artists?: Array<{ name?: string }>;
  external_urls?: { spotify?: string };
  album?: { images?: Array<{ url?: string }> };
}

interface SpotifyTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface SpotifyCollectionMirror {
  name: string;
  tracks: Track[];
  nodeName: string;
  skipped: number;
}

export class SpotifyAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyAuthorizationError';
  }
}

interface CacheEntry {
  expiresAt: number;
  value: SpotifyOEmbed | null;
}

const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 15 * 60 * 1000;

export function parseSpotifyUrl(input: string): SpotifyReference | null {
  try {
    const url = new URL(input);
    if (url.hostname !== 'open.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('intl-')) parts.shift();
    const type = parts[0] as SpotifyEntity;
    const id = parts[1];
    if (!['track', 'album', 'playlist'].includes(type) || !id) return null;
    return { type, id, url: `https://open.spotify.com/${type}/${id}` };
  } catch {
    return null;
  }
}

function normalize(value: string): string[] {
  return value.toLowerCase()
    .replace(/\([^)]*(official|lyrics?|audio|video)[^)]*\)/gi, ' ')
    .replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function scoreTrack(track: Track, metadataTitle: string): number {
  const wanted = new Set(normalize(metadataTitle));
  const candidate = new Set(normalize(`${track.info.title} ${track.info.author}`));
  let matched = 0;
  for (const token of wanted) if (candidate.has(token)) matched++;
  let score = wanted.size ? matched / wanted.size : 0;
  const combined = `${track.info.title} ${track.info.author}`.toLowerCase();
  if (combined.includes('official audio')) score += 0.15;
  if (combined.includes('topic')) score += 0.1;
  if (track.info.isStream) score -= 0.5;
  return score;
}

export class SpotifyFallbackService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<SpotifyOEmbed | null>>();
  private userToken: { value: string; expiresAt: number } | null = null;

  async resolveTrack(client: AureliaClient, reference: SpotifyReference, preferredNode?: string) {
    if (reference.type !== 'track' || process.env.SPOTIFY_TRACK_FALLBACK_ENABLED === 'false') return null;
    const metadata = await this.getMetadata(reference.url);
    if (!metadata?.title) return null;

    let best: { track: Track; nodeName: string; score: number } | null = null;
    for (const prefix of ['ytmsearch:', 'ytsearch:']) {
      const resolved = await client.resolveTrack(`${prefix}${metadata.title}`, preferredNode, true);
      if (!resolved || resolved.result.loadType !== 'search' || !Array.isArray(resolved.result.data)) continue;
      for (const track of (resolved.result.data as Track[]).slice(0, 10)) {
        const score = scoreTrack(track, metadata.title);
        if (!best || score > best.score) best = { track, nodeName: resolved.node.name, score };
      }
      if (best && best.score >= 0.75) break;
    }

    if (!best || best.score < 0.35) return null;
    const sourceUri = best.track.info.uri;
    const mirrored: Track = {
      ...best.track,
      info: {
        ...best.track.info,
        uri: reference.url,
        artworkUrl: metadata.thumbnail_url || best.track.info.artworkUrl,
      },
      pluginInfo: {
        ...(best.track.pluginInfo || {}),
        spotifyMirror: true,
        spotifyUrl: reference.url,
        playbackSource: sourceUri,
      },
    };
    return { track: mirrored, nodeName: best.nodeName };
  }

  async resolveCollection(
    client: AureliaClient,
    reference: SpotifyReference,
    preferredNode?: string,
  ): Promise<SpotifyCollectionMirror | null> {
    if (!['playlist', 'album'].includes(reference.type)) return null;
    const accessToken = await this.getUserAccessToken();
    const metadata = await this.getMetadata(reference.url);
    const apiTracks = await this.fetchCollectionTracks(reference, accessToken);
    if (apiTracks.length === 0) return null;

    const concurrency = Math.max(1, Math.min(6, Number(process.env.SPOTIFY_MIRROR_CONCURRENCY) || 3));
    const mirrored: Array<{ index: number; track: Track; nodeName: string }> = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, apiTracks.length) }, async () => {
      while (cursor < apiTracks.length) {
        const index = cursor++;
        const item = apiTracks[index];
        const title = item.name?.trim();
        const artist = item.artists?.map((entry) => entry.name).filter(Boolean).join(', ') || '';
        if (!title || !artist || item.is_local) continue;
        const resolved = await this.resolveMetadataTrack(client, {
          title: `${artist} - ${title}`,
          spotifyUrl: item.external_urls?.spotify || `https://open.spotify.com/track/${item.id || ''}`,
          artworkUrl: item.album?.images?.[0]?.url,
          durationMs: item.duration_ms,
        }, preferredNode);
        if (resolved) mirrored.push({ index, ...resolved });
      }
    });
    await Promise.all(workers);
    mirrored.sort((a, b) => a.index - b.index);
    if (mirrored.length === 0) return null;

    return {
      name: metadata?.title || `${reference.type === 'playlist' ? 'Playlist' : 'Album'} Spotify`,
      tracks: mirrored.map((entry) => entry.track),
      nodeName: mirrored[0].nodeName,
      skipped: apiTracks.length - mirrored.length,
    };
  }

  private async resolveMetadataTrack(
    client: AureliaClient,
    metadata: { title: string; spotifyUrl: string; artworkUrl?: string; durationMs?: number },
    preferredNode?: string,
  ): Promise<{ track: Track; nodeName: string } | null> {
    let best: { track: Track; nodeName: string; score: number } | null = null;
    for (const prefix of ['ytmsearch:', 'ytsearch:']) {
      const resolved = await client.resolveTrack(`${prefix}${metadata.title}`, preferredNode, true);
      if (!resolved || resolved.result.loadType !== 'search' || !Array.isArray(resolved.result.data)) continue;
      for (const track of (resolved.result.data as Track[]).slice(0, 10)) {
        let score = scoreTrack(track, metadata.title);
        if (metadata.durationMs && track.info.length) {
          const difference = Math.abs(track.info.length - metadata.durationMs);
          score += difference <= 5000 ? 0.2 : difference <= 15000 ? 0.05 : -0.2;
        }
        if (!best || score > best.score) best = { track, nodeName: resolved.node.name, score };
      }
      if (best && best.score >= 0.85) break;
    }
    if (!best || best.score < 0.35) return null;

    const playbackSource = best.track.info.uri;
    return {
      nodeName: best.nodeName,
      track: {
        ...best.track,
        info: {
          ...best.track.info,
          uri: metadata.spotifyUrl,
          artworkUrl: metadata.artworkUrl || best.track.info.artworkUrl,
        },
        pluginInfo: {
          ...(best.track.pluginInfo || {}),
          spotifyMirror: true,
          spotifyUrl: metadata.spotifyUrl,
          playbackSource,
        },
      },
    };
  }

  private async getUserAccessToken(): Promise<string> {
    if (this.userToken && this.userToken.expiresAt > Date.now()) return this.userToken.value;
    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
    const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN?.trim();
    if (!clientId || !clientSecret || !refreshToken) {
      throw new SpotifyAuthorizationError(
        'Playlist Spotify memerlukan SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, dan SPOTIFY_REFRESH_TOKEN dari akun Spotify pemilik aplikasi.',
      );
    }

    const response = await this.fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const payload = await response.json() as SpotifyTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new SpotifyAuthorizationError(
        `OAuth Spotify gagal (${response.status}): ${payload.error_description || payload.error || 'refresh token tidak valid'}.`,
      );
    }
    const expiresIn = Math.max(60, payload.expires_in || 3600);
    this.userToken = { value: payload.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
    return payload.access_token;
  }

  private async fetchCollectionTracks(reference: SpotifyReference, accessToken: string): Promise<SpotifyApiTrack[]> {
    const configuredLimit = Number(process.env.SPOTIFY_PLAYLIST_MAX_TRACKS) || 500;
    const maxTracks = Math.max(1, Math.min(600, configuredLimit));
    const tracks: SpotifyApiTrack[] = [];
    let offset = 0;
    while (tracks.length < maxTracks) {
      const endpoint = reference.type === 'playlist'
        ? `https://api.spotify.com/v1/playlists/${reference.id}/items?limit=50&offset=${offset}`
        : `https://api.spotify.com/v1/albums/${reference.id}/tracks?limit=50&offset=${offset}`;
      const response = await this.fetchWithTimeout(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 401) this.userToken = null;
        const explanation = response.status === 403 || response.status === 404
          ? 'Pastikan playlist dimiliki atau dikolaborasikan oleh akun OAuth dan scope playlist-read-private serta playlist-read-collaborative diberikan.'
          : 'Periksa refresh token Spotify dan konfigurasi aplikasi.';
        throw new SpotifyAuthorizationError(`Spotify API ${response.status}. ${explanation}${detail ? ` (${detail.slice(0, 180)})` : ''}`);
      }
      const page = await response.json() as {
        items?: Array<SpotifyApiTrack | { item?: SpotifyApiTrack; track?: SpotifyApiTrack }>;
        next?: string | null;
      };
      const items = page.items || [];
      for (const entry of items) {
        const wrapped = entry as { item?: SpotifyApiTrack; track?: SpotifyApiTrack };
        const track = wrapped.item || wrapped.track || entry as SpotifyApiTrack;
        if (track?.name) tracks.push(track);
        if (tracks.length >= maxTracks) break;
      }
      if (!page.next || items.length === 0) break;
      offset += items.length;
    }
    return tracks;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getMetadata(url: string): Promise<SpotifyOEmbed | null> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const active = this.inflight.get(url);
    if (active) return active;

    const request = this.fetchMetadata(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, request);
    return request;
  }

  private async fetchMetadata(url: string): Promise<SpotifyOEmbed | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
        headers: { 'User-Agent': 'WonderplayMusic/1.0.0 (Discord music bot)' },
        signal: controller.signal,
      });
      if (!response.ok) {
        this.cache.set(url, { value: null, expiresAt: Date.now() + FAILURE_TTL });
        return null;
      }
      const value = await response.json() as SpotifyOEmbed;
      this.cache.set(url, { value, expiresAt: Date.now() + SUCCESS_TTL });
      return value;
    } catch (error) {
      logger.warn({ error, url }, 'Spotify oEmbed metadata request failed');
      this.cache.set(url, { value: null, expiresAt: Date.now() + FAILURE_TTL });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const spotifyFallbackService = new SpotifyFallbackService();
