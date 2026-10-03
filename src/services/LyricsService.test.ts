import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LyricsService,
  normalizeArtist,
  normalizeTrackTitle,
  splitLyrics,
  stripSyncedTimestamps,
} from './LyricsService';

test('normalizes common YouTube title and artist suffixes', () => {
  assert.equal(normalizeTrackTitle('Adele - Hello (Official Lyrics Video)'), 'Adele - Hello');
  assert.equal(normalizeArtist('Adele - Topic'), 'Adele');
});

test('strips timestamps and splits lyrics on line boundaries', () => {
  assert.equal(stripSyncedTimestamps('[00:01.20]First line\n[01:02]Second line'), 'First line\nSecond line');
  const pages = splitLyrics('one\ntwo\nthree', 7);
  assert.deepEqual(pages, ['one\ntwo', 'three']);
});

test('deduplicates concurrent LRCLIB requests and caches successful results', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      trackName: 'Hello',
      artistName: 'Adele',
      duration: 295,
      instrumental: false,
      plainLyrics: 'Hello from the other side',
      syncedLyrics: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const service = new LyricsService('https://example.test', fetcher);
  const metadata = { title: 'Hello', artist: 'Adele', durationMs: 295000 };
  const [first, second] = await Promise.all([service.getLyrics(metadata), service.getLyrics(metadata)]);
  const third = await service.getLyrics(metadata);
  assert.equal(first?.trackName, 'Hello');
  assert.equal(second?.trackName, 'Hello');
  assert.equal(third?.trackName, 'Hello');
  assert.equal(calls, 1);
});

test('falls back to normalized metadata when the raw title is not found', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({
      trackName: 'Hello', artistName: 'Adele', duration: 295,
      instrumental: false, plainLyrics: 'Lyrics', syncedLyrics: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const service = new LyricsService('https://example.test', fetcher);
  const result = await service.getLyrics({
    title: 'Hello (Official Lyrics Video)', artist: 'Adele - Topic', durationMs: 295000,
  });
  assert.equal(result?.plainLyrics, 'Lyrics');
  assert.equal(urls.length, 2);
  assert.match(urls[1], /track_name=Hello/);
});
