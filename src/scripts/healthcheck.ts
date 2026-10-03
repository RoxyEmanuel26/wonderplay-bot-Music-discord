import 'dotenv/config';
import { db } from '../database/db';
import { redis } from '../database/redis';
import { PUBLIC_LAVALINK_NODES } from '../config/lavalinkNodes';
import type { NodeOption } from 'shoukaku';
import WebSocket from 'ws';

type CheckResult = {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
};

const results: CheckResult[] = [];

async function check(name: string, operation: () => Promise<string>, required = true) {
  try {
    results.push({ name, ok: true, required, detail: await operation() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      ok: false,
      required,
      detail,
    });
  }
}

async function lavalinkRequest(node: NodeOption, path: string) {
  const response = await fetch(`${node.secure ? 'https' : 'http'}://${node.url}${path}`, {
    headers: { Authorization: node.auth },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? ' (otorisasi node publik ditolak; perbarui kredensial node publik)'
      : '';
    throw new Error(`HTTP ${response.status} ${response.statusText}${hint}`);
  }
  return response;
}

async function lavalinkHandshake(node: NodeOption): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${node.secure ? 'wss' : 'ws'}://${node.url}/v4/websocket`, {
      headers: {
        Authorization: node.auth,
        'User-Id': process.env.CLIENT_ID?.trim() || '123456789012345678',
        'Client-Name': 'WonderplayHealthcheck/1.0',
      },
      handshakeTimeout: 6500,
    });
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('WebSocket ready timeout')), 7000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.terminate();
      if (error) reject(error);
      else resolve();
    }
    socket.on('message', (message) => {
      try {
        if ((JSON.parse(message.toString()) as { op?: string }).op === 'ready') finish();
      } catch { /* Ignore non-JSON frames until ready or timeout. */ }
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(new Error(`WebSocket HTTP ${response.statusCode}`));
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', (code) => finish(new Error(`WebSocket closed ${code} before ready`)));
  });
}

function summarizeLoadResult(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'respons tidak valid';
  const result = payload as { loadType?: string; data?: unknown };
  const tracks = Array.isArray(result.data)
    ? result.data
    : result.data && typeof result.data === 'object' && 'tracks' in result.data
      ? (result.data as { tracks?: unknown[] }).tracks || []
      : result.data ? [result.data] : [];
  const sources = [...new Set(tracks.map((track) => (
    track && typeof track === 'object' && 'info' in track
      ? String((track as { info?: { sourceName?: string } }).info?.sourceName || 'unknown')
      : 'unknown'
  )))];
  return `loadType=${result.loadType || 'unknown'}, tracks=${tracks.length}, sources=${sources.join(',') || '-'}`;
}

async function main() {
  await check('PostgreSQL', async () => {
    await db.$queryRaw`SELECT 1`;
    return 'query SELECT 1 berhasil';
  });

  await check('Redis', async () => {
    const pong = await redis.ping();
    return `PING=${pong}`;
  });

  await check('Discord token', async () => {
    const token = process.env.DISCORD_TOKEN?.trim();
    if (!token) throw new Error('DISCORD_TOKEN belum dikonfigurasi');
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const user = await response.json() as { username?: string };
    return `token valid untuk ${user.username || 'bot'}`;
  });

  let activeNode: NodeOption | undefined;
  for (const node of PUBLIC_LAVALINK_NODES) {
    await check(`Lavalink publik ${node.name}`, async () => {
      const info = await (await lavalinkRequest(node, '/v4/info')).json() as {
        version?: { semver?: string };
        plugins?: Array<{ name: string }>;
        sourceManagers?: string[];
      };
      await lavalinkHandshake(node);
      activeNode ??= node;
      return `WebSocket ready, v${info.version?.semver || '?'}, plugins=${info.plugins?.map((plugin) => plugin.name).join(',') || '-'}, sources=${info.sourceManagers?.join(',') || '-'}`;
    }, false);
  }
  await check('Lavalink publik tersedia', async () => {
    if (!activeNode) throw new Error('Semua node publik tidak tersedia');
    return activeNode.name;
  });

  const identifiers = [
    ['YouTube URL', 'https://www.youtube.com/watch?v=EupWletn-Vo'],
    ['YouTube Music search', 'ytmsearch:lagu sedih'],
    ['YouTube search', 'ytsearch:lagu sedih'],
    ['SoundCloud fallback search', 'scsearch:lagu sedih'],
    ['Spotify track', 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'],
  ] as const;
  for (const [name, identifier] of identifiers) {
    if (!activeNode) break;
    const node = activeNode;
    await check(name, async () => {
      const response = await lavalinkRequest(node, `/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`);
      return summarizeLoadResult(await response.json());
    });
  }

  // /v4/loadtracks may return valid metadata even when every YouTube client
  // later fails to obtain an audio URL. The plugin stream route exercises the
  // actual format/client selection without joining a Discord voice channel.
  if (activeNode) {
    const node = activeNode;
    await check('YouTube audio stream', async () => {
      const response = await lavalinkRequest(node, '/youtube/stream/EupWletn-Vo');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('respons stream tidak memiliki body audio');
      const first = await reader.read();
      await reader.cancel();
      if (first.done || !first.value?.byteLength) throw new Error('stream audio kosong');
      return `${response.headers.get('content-type') || 'audio'}, chunk=${first.value.byteLength} byte`;
    }, false);
  }

  await check('Spotify oEmbed', async () => {
    const url = new URL('https://open.spotify.com/oembed');
    url.searchParams.set('url', 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl');
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const data = await response.json() as { title?: string };
    return data.title ? 'metadata track tersedia' : 'respons tanpa judul';
  });

  await check('Spotify OAuth refresh', async () => {
    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
    const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN?.trim();
    if (!clientId || !clientSecret || !refreshToken) return 'dilewati (credential OAuth belum lengkap)';
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return 'refresh token valid';
  });

  await check('LRCLIB', async () => {
    const base = (process.env.LYRICS_API_URL || 'https://lrclib.net').replace(/\/$/, '');
    const response = await fetch(`${base}/api/search?track_name=Hello&artist_name=Adele`, {
      headers: { 'User-Agent': 'WonderplayMusic/1.0.0 (healthcheck)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const data = await response.json() as unknown[];
    return `${Array.isArray(data) ? data.length : 0} kandidat lirik`;
  });

  for (const result of results) {
    const status = result.ok ? 'PASS' : result.required ? 'FAIL' : 'WARN';
    process.stdout.write(`${status} ${result.name}: ${result.detail}\n`);
  }
  process.exitCode = results.some((result) => !result.ok && result.required) ? 1 : 0;
}

void main().finally(async () => {
  redis.disconnect();
  await db.$disconnect();
});
