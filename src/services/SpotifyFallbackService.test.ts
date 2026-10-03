import assert from 'node:assert/strict';
import test from 'node:test';
import { Track } from 'shoukaku';
import {
  parseSpotifyUrl,
  SpotifyAuthorizationError,
  SpotifyFallbackService,
} from './SpotifyFallbackService';
import type { AureliaClient } from '../structures/AureliaClient';

function track(): Track {
  return {
    encoded: 'youtube-encoded',
    info: {
      identifier: 'id', isSeekable: true, author: 'Artist - Topic', length: 180000,
      isStream: false, position: 0, title: 'Artist Song Official Audio',
      uri: 'https://youtube.test/watch?v=id', artworkUrl: undefined, isrc: undefined,
      sourceName: 'youtube',
    },
    pluginInfo: {},
  };
}

test('parses canonical and localized Spotify links safely', () => {
  assert.deepEqual(parseSpotifyUrl('https://open.spotify.com/intl-id/track/abc?si=1'), {
    type: 'track', id: 'abc', url: 'https://open.spotify.com/track/abc',
  });
  assert.equal(parseSpotifyUrl('https://example.com/track/abc'), null);
});

test('uses official oEmbed metadata and preserves Spotify presentation URI', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    title: 'Artist - Song', thumbnail_url: 'https://image.test/cover.jpg',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const client = {
      resolveTrack: async () => ({
        result: { loadType: 'search', data: [track()] },
        node: { name: 'node-a' },
      }),
    } as unknown as AureliaClient;
    const service = new SpotifyFallbackService();
    const ref = parseSpotifyUrl('https://open.spotify.com/track/abc')!;
    const result = await service.resolveTrack(client, ref);
    assert.equal(result?.track.info.uri, ref.url);
    assert.equal(result?.track.info.artworkUrl, 'https://image.test/cover.jpg');
    const pluginInfo = result?.track.pluginInfo as Record<string, unknown>;
    assert.equal(pluginInfo.playbackSource, 'https://youtube.test/watch?v=id');
    assert.equal(pluginInfo.spotifyMirror, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('imports an owned Spotify playlist through user OAuth and mirrors tracks in order', async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    id: process.env.SPOTIFY_CLIENT_ID,
    secret: process.env.SPOTIFY_CLIENT_SECRET,
    refresh: process.env.SPOTIFY_REFRESH_TOKEN,
  };
  process.env.SPOTIFY_CLIENT_ID = 'client';
  process.env.SPOTIFY_CLIENT_SECRET = 'secret';
  process.env.SPOTIFY_REFRESH_TOKEN = 'refresh';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('accounts.spotify.com/api/token')) {
      return new Response(JSON.stringify({ access_token: 'user-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('open.spotify.com/oembed')) {
      return new Response(JSON.stringify({ title: 'My Playlist' }), { status: 200 });
    }
    if (url.includes('/v1/playlists/playlist-id/items')) {
      return new Response(JSON.stringify({
        items: [
          { item: { id: 'one', name: 'First', duration_ms: 180000, artists: [{ name: 'Artist A' }], external_urls: { spotify: 'https://open.spotify.com/track/one' } } },
          { item: { id: 'two', name: 'Second', duration_ms: 180000, artists: [{ name: 'Artist B' }], external_urls: { spotify: 'https://open.spotify.com/track/two' } } },
        ],
        next: null,
      }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const client = {
      resolveTrack: async () => ({
        result: { loadType: 'search', data: [track()] },
        node: { name: 'node-a' },
      }),
    } as unknown as AureliaClient;
    const service = new SpotifyFallbackService();
    const reference = parseSpotifyUrl('https://open.spotify.com/playlist/playlist-id')!;
    const result = await service.resolveCollection(client, reference);
    assert.equal(result?.name, 'My Playlist');
    assert.equal(result?.tracks.length, 2);
    assert.equal(result?.tracks[0].info.uri, 'https://open.spotify.com/track/one');
    assert.equal((result?.tracks[1].pluginInfo as Record<string, unknown>).spotifyMirror, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.id === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = previous.id;
    if (previous.secret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    else process.env.SPOTIFY_CLIENT_SECRET = previous.secret;
    if (previous.refresh === undefined) delete process.env.SPOTIFY_REFRESH_TOKEN;
    else process.env.SPOTIFY_REFRESH_TOKEN = previous.refresh;
  }
});

test('explains that Spotify playlist fallback requires a user refresh token', async () => {
  const previous = process.env.SPOTIFY_REFRESH_TOKEN;
  delete process.env.SPOTIFY_REFRESH_TOKEN;
  try {
    const service = new SpotifyFallbackService();
    const reference = parseSpotifyUrl('https://open.spotify.com/playlist/playlist-id')!;
    await assert.rejects(
      () => service.resolveCollection({} as AureliaClient, reference),
      SpotifyAuthorizationError,
    );
  } finally {
    if (previous === undefined) delete process.env.SPOTIFY_REFRESH_TOKEN;
    else process.env.SPOTIFY_REFRESH_TOKEN = previous;
  }
});
