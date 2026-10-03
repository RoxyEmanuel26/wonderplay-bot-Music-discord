import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { after } from 'node:test';
import { Player, Track } from 'shoukaku';
import { Queue } from './Queue';
import { AureliaClient } from './AureliaClient';
import { db } from '../database/db';
import { isDiscordSnowflake, playbackSessionService } from '../services/PlaybackSessionService';

// Queue mutasi menjadwalkan checkpoint secara otomatis. Unit test tidak boleh
// pernah menulis snapshot guild palsu ke database yang dikonfigurasi pengguna.
process.env.PLAYBACK_PERSISTENCE_ENABLED = 'false';

after(async () => {
  await db.$disconnect();
});

class FakePlayer extends EventEmitter {
  public node: { name: string; state: number; sessionId: string | null } = {
    name: 'node-a',
    state: 1,
    sessionId: 'session-a',
  };
  public volume = 100;
  public paused = false;
  public position = 0;
  public track: Track | null = null;
  public played: string[] = [];
  public emitCloseOnMove = false;
  public failVolume = false;
  public filterCalls: string[] = [];
  public stopCalls = 0;
  public playError: unknown = null;

  async playTrack(options: { track: { encoded: string } }) {
    this.played.push(options.track.encoded);
    if (this.playError) throw this.playError;
  }

  async stopTrack() { this.stopCalls++; }
  async setGlobalVolume(volume: number) {
    if (this.failVolume) throw new Error('volume rejected');
    this.volume = volume;
  }
  async setPaused(paused: boolean) { this.paused = paused; }
  async seekTo(position: number) { this.position = position; }
  async clearFilters() { this.filterCalls.push('clear'); }
  async setEqualizer() { this.filterCalls.push('equalizer'); }
  async setTimescale() { this.filterCalls.push('timescale'); }
  async setKaraoke() { this.filterCalls.push('karaoke'); }
  async move(name: string) {
    this.node.name = name;
    if (this.emitCloseOnMove) this.emit('closed', { code: 1000, reason: '' });
    return true;
  }
}

function makeTrack(encoded: string, sourceName = 'youtube', title = `Track ${encoded}`): Track {
  return {
    encoded,
    info: {
      identifier: encoded,
      isSeekable: true,
      author: 'Artist',
      length: 180000,
      isStream: false,
      position: 0,
      title,
      uri: `https://example.test/${encoded}`,
      artworkUrl: undefined,
      isrc: undefined,
      sourceName,
    },
    pluginInfo: {},
  };
}

function createQueue() {
  const player = new FakePlayer();
  const channel = { id: 'text', send: async () => ({ id: 'message', delete: async () => undefined }) };
  const listener = { voice: { channelId: 'voice' } };
  const guild = {
    members: {
      me: { voice: { channelId: 'voice' } },
      cache: new Map([['listener', listener]]),
      fetch: async () => listener,
    },
    channels: { cache: new Map() },
  };
  let leaveCalls = 0;
  const client = {
    queues: new Map(),
    shoukaku: {
      nodes: new Map(),
      connections: new Map([['guild', { channelId: 'voice' }]]),
      leaveVoiceChannel: async () => { leaveCalls++; },
    },
    guilds: { cache: new Map([['guild', guild]]) },
    resolveTrack: async (_query: string): Promise<unknown> => null,
    isLavalinkNodeHealthy(name: string) {
      const node = this.shoukaku.nodes.get(name);
      return Boolean(node && node.state === 1 && node.sessionId);
    },
  };
  const queue = new Queue(
    client as unknown as AureliaClient,
    player as unknown as Player,
    channel as never,
    'guild',
  );
  return { queue, player, client, guild, getLeaveCalls: () => leaveCalls };
}

function makeControlInteraction(guild: unknown, customId: string, values: string[] = []) {
  return {
    customId,
    user: { id: 'listener' },
    guild,
    values,
    deferred: false,
    replied: false,
    followUps: [] as unknown[],
    async deferUpdate() { this.deferred = true; },
    async followUp(value: unknown) { this.followUps.push(value); },
    isStringSelectMenu() { return customId === 'music:queue' || customId === 'music:filter-select'; },
  };
}

async function settle(queue: Queue) {
  await (queue as unknown as { operation: Promise<void> }).operation;
}

test('playback persistence accepts Discord snowflakes and rejects test identifiers', () => {
  assert.equal(isDiscordSnowflake('1343830402061697097'), true);
  assert.equal(isDiscordSnowflake('1555093877772255296'), true);
  assert.equal(isDiscordSnowflake('guild'), false);
  assert.equal(isDiscordSnowflake(''), false);
});

test('natural finish advances exactly once to the next track', async () => {
  const { queue, player } = createQueue();
  const first = makeTrack('one');
  const second = makeTrack('two');
  await queue.enqueueMany([first, second]);
  player.emit('end', { reason: 'finished', track: first });
  await settle(queue);
  assert.equal(queue.current?.encoded, 'two');
  assert.deepEqual(player.played, ['one', 'two']);
  assert.deepEqual(queue.history.map((track) => track.encoded), ['one']);
  queue.dispose();
});

test('late finished event cannot advance the replacement selected by next', async () => {
  const { queue, player } = createQueue();
  const first = makeTrack('one');
  const second = makeTrack('two');
  const third = makeTrack('three');
  await queue.enqueueMany([first, second, third]);
  const skip = queue.skip();
  player.emit('end', { reason: 'finished', track: first });
  await skip;
  await settle(queue);
  assert.equal(queue.current?.encoded, 'two');
  assert.deepEqual(player.played, ['one', 'two']);
  queue.dispose();
});

test('generation guard protects consecutive tracks with the same encoded value', async () => {
  const { queue, player } = createQueue();
  const first = makeTrack('duplicate');
  const second = makeTrack('duplicate');
  const third = makeTrack('three');
  await queue.enqueueMany([first, second, third]);
  const skip = queue.skip();
  player.emit('end', { reason: 'finished', track: first });
  await skip;
  await settle(queue);
  assert.equal(queue.current, second);
  assert.equal(queue.tracks[0], third);
  assert.deepEqual(player.played, ['duplicate', 'duplicate']);
  queue.dispose();
});

test('loadFailed keeps current and queue intact while every node is offline', async () => {
  const { queue, player } = createQueue();
  const first = makeTrack('one');
  const second = makeTrack('two');
  await queue.enqueueMany([first, second]);
  player.emit('end', { reason: 'loadFailed', track: first });
  await settle(queue);
  assert.equal(queue.current?.encoded, 'one');
  assert.deepEqual(queue.tracks.map((track) => track.encoded), ['two']);
  assert.equal(queue.state, 'RECOVERING');
  assert.deepEqual(player.played, ['one']);
  queue.dispose();
});

test('a null Lavalink session parks playback without consuming the queue or calling stopTrack', async () => {
  const { queue, player } = createQueue();
  player.node.sessionId = null;

  await queue.enqueueMany([makeTrack('one'), makeTrack('two')]);

  assert.equal(queue.current?.encoded, 'one');
  assert.deepEqual(queue.tracks.map((track) => track.encoded), ['two']);
  assert.equal(queue.state, 'RECOVERING');
  assert.deepEqual(player.played, []);
  assert.equal(player.stopCalls, 0);
  queue.dispose();
});

test('node ready replaces a stale null-session node reference and resumes the retained track', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack('one');
  const replacement = makeTrack('one-resolved');
  player.node.sessionId = null;

  await queue.enqueueMany([original, makeTrack('two')]);
  client.shoukaku.nodes.set('node-a', {
    name: 'node-a',
    state: 1,
    sessionId: 'new-session',
    penalties: 0,
  });
  client.resolveTrack = async () => ({ result: { data: replacement }, node: { name: 'node-a' } });
  queue.handleNodeReady('node-a');
  await settle(queue);

  assert.equal(queue.current?.encoded, 'one-resolved');
  assert.deepEqual(queue.tracks.map((track) => track.encoded), ['two']);
  assert.equal(queue.state, 'PLAYING');
  assert.deepEqual(player.played, ['one-resolved']);
  assert.equal(player.node.sessionId, 'new-session');
  queue.dispose();
});

test('a 404 stale-session failure retains current and remaining tracks for reconnect', async () => {
  const { queue, player } = createQueue();
  player.playError = {
    name: 'RestError',
    message: 'Session not found',
    status: 404,
    path: '/v4/sessions/stale-session/players/guild',
  };

  await queue.enqueueMany([makeTrack('one'), makeTrack('two')]);

  assert.equal(queue.current?.encoded, 'one');
  assert.deepEqual(queue.tracks.map((track) => track.encoded), ['two']);
  assert.equal(queue.state, 'RECOVERING');
  assert.deepEqual(player.played, ['one']);
  assert.equal(player.stopCalls, 0);
  queue.dispose();
});

test('loadFailed skips only a bad track when a healthy node cannot resolve it', async () => {
  const { queue, player, client } = createQueue();
  const first = makeTrack('one');
  const second = makeTrack('two');
  client.shoukaku.nodes.set('node-a', { name: 'node-a', state: 1, sessionId: 'session-a', penalties: 0 });
  await queue.enqueueMany([first, second]);
  player.emit('end', { reason: 'loadFailed', track: first });
  await settle(queue);
  assert.equal(queue.current?.encoded, 'two');
  assert.deepEqual(player.played, ['one', 'two']);
  queue.dispose();
});

test('source-wide YouTube login failure parks the track instead of deleting it', async () => {
  const { queue, player, client } = createQueue();
  const blocked = makeTrack('login-required');
  client.shoukaku.nodes.set('node-a', { name: 'node-a', state: 1, sessionId: 'session-a', penalties: 0 });
  await queue.enqueue(blocked);

  player.emit('exception', {
    track: blocked,
    exception: {
      message: '(yts.version: 1.18.2) All clients failed to load the item. Client [ANDROID_VR] failed: This video requires login. Client [WEB] failed: No supported audio streams available',
      cause: 'AllClientsFailedException',
    },
  });
  await settle(queue);

  assert.equal(queue.current, blocked);
  assert.equal(queue.state, 'RECOVERING');
  assert.match(queue.recoveryReason || '', /YouTube menolak stream/);
  queue.dispose();
});

test('loadFailed after an automatic node move re-resolves the current track on the destination node', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack('one');
  const replacement = makeTrack('one-on-node-b');
  await queue.enqueue(original);
  player.node.name = 'node-b';
  client.shoukaku.nodes.set('node-b', { name: 'node-b', state: 1, sessionId: 'session-b', penalties: 0 });
  client.resolveTrack = async () => ({ result: { data: replacement }, node: { name: 'node-b' } });
  player.emit('end', { reason: 'loadFailed', track: original });
  await settle(queue);
  assert.equal(queue.current, replacement);
  assert.deepEqual(player.played, ['one', 'one-on-node-b']);
  queue.dispose();
});

test('normal close emitted by player.move does not start a second recovery', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack('one');
  const replacement = makeTrack('one-on-node-b');
  client.shoukaku.nodes.set('node-a', { name: 'node-a', state: 1, sessionId: 'session-a', penalties: 0 });
  client.shoukaku.nodes.set('node-b', { name: 'node-b', state: 1, sessionId: 'session-b', penalties: 1 });
  client.resolveTrack = async () => ({ result: { data: replacement }, node: { name: 'node-b' } });
  player.emitCloseOnMove = true;

  await queue.enqueue(original);
  player.emit('end', { reason: 'loadFailed', track: original });
  await settle(queue);

  assert.equal(queue.current?.encoded, 'one-on-node-b');
  assert.equal(queue.state, 'PLAYING');
  assert.equal((queue as unknown as { recoveryTimer: NodeJS.Timeout | null }).recoveryTimer, null);
  assert.deepEqual(player.played, ['one', 'one-on-node-b']);
  queue.dispose();
});

test('a YouTube video that fails on every node is mirrored to a different matching upload', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack('blocked-video');
  const alternative = makeTrack('working-upload');
  client.shoukaku.nodes.set('node-a', { name: 'node-a', state: 1, sessionId: 'session-a', penalties: 0 });
  client.resolveTrack = async (query: string) => {
    if (!query.startsWith('ytmsearch:') && !query.startsWith('ytsearch:')) return null;
    return { result: { data: [original, alternative] }, node: { name: 'node-a' } };
  };

  await queue.enqueue(original);
  player.emit('end', { reason: 'loadFailed', track: original });
  await settle(queue);

  assert.equal(queue.current?.encoded, 'working-upload');
  assert.equal(queue.state, 'PLAYING');
  assert.equal(
    (queue.current?.pluginInfo as Record<string, unknown>).youtubeAlternativeFor,
    original.info.uri,
  );
  assert.deepEqual(player.played, ['blocked-video', 'working-upload']);
  queue.dispose();
});

test('a source-wide YouTube failure prefers a matching SoundCloud mirror', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack('blocked-video', 'youtube', 'Just Love You');
  const soundcloud = makeTrack('soundcloud-mirror', 'soundcloud', 'Just Love You');
  soundcloud.info.author = 'Artist';
  soundcloud.info.uri = 'https://soundcloud.com/artist/just-love-you';
  client.shoukaku.nodes.set('node-a', { name: 'node-a', state: 1, sessionId: 'session-a', penalties: 0 });
  client.resolveTrack = async (query: string) => {
    if (!query.startsWith('scsearch:')) return null;
    return { result: { data: [soundcloud] }, node: { name: 'node-a' } };
  };

  await queue.enqueue(original);
  player.emit('end', { reason: 'loadFailed', track: original });
  await settle(queue);

  assert.equal(queue.current?.encoded, 'soundcloud-mirror');
  assert.equal(queue.current?.info.sourceName, 'soundcloud');
  assert.equal(queue.state, 'PLAYING');
  assert.match(queue.recoveryReason || '', /SoundCloud/);
  assert.deepEqual(player.played, ['blocked-video', 'soundcloud-mirror']);
  queue.dispose();
});

test('cross-source fallback strips YouTube promotional suffixes before searching', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack(
    'blocked-video',
    'youtube',
    '丁芙妮 - 只是太愛你『我們的愛快要窒息 不是故意』【Lyrics Video】',
  );
  original.info.author = 'Boba Beats';
  original.info.length = 248000;
  const soundcloud = makeTrack('soundcloud-mirror', 'soundcloud', '丁芙妮 - 只是太愛你');
  soundcloud.info.author = 'EileenLove';
  soundcloud.info.length = 248000;
  client.shoukaku.nodes.set('node-a', { name: 'node-a', state: 1, sessionId: 'session-a', penalties: 0 });
  const queries: string[] = [];
  client.resolveTrack = async (query: string) => {
    queries.push(query);
    if (query !== 'scsearch:丁芙妮 - 只是太愛你') return null;
    return { result: { data: [soundcloud] }, node: { name: 'node-a' } };
  };

  await queue.enqueue(original);
  player.emit('end', { reason: 'loadFailed', track: original });
  await settle(queue);

  assert.equal(queries[0], 'scsearch:丁芙妮 - 只是太愛你');
  assert.equal(queue.current?.encoded, 'soundcloud-mirror');
  assert.deepEqual(player.played, ['blocked-video', 'soundcloud-mirror']);
  queue.dispose();
});

test('normal player close keeps the queue while Discord voice is still connected', async () => {
  const { queue, player } = createQueue();
  await queue.enqueue(makeTrack('one'));
  player.emit('closed', { code: 1000, reason: '' });
  assert.equal(queue.current?.encoded, 'one');
  queue.dispose();
});

test('stop clears playback but keeps the Discord voice connection', async () => {
  const { queue, getLeaveCalls } = createQueue();
  await queue.enqueueMany([makeTrack('one'), makeTrack('two')]);
  await queue.stop();
  assert.equal(queue.current, null);
  assert.deepEqual(queue.tracks, []);
  assert.equal(queue.state, 'IDLE');
  assert.equal(getLeaveCalls(), 0);
  queue.dispose();
});

test('a ready node wakes a parked queue and resumes the retained track', async () => {
  const { queue, player, client } = createQueue();
  const original = makeTrack('one');
  const replacement = makeTrack('one-node-b');
  await queue.enqueue(original);
  player.emit('end', { reason: 'loadFailed', track: original });
  await settle(queue);
  assert.equal(queue.state, 'RECOVERING');
  client.shoukaku.nodes.set('node-b', { name: 'node-b', state: 1, sessionId: 'session-b', penalties: 0 });
  client.resolveTrack = async () => ({ result: { data: replacement }, node: { name: 'node-b' } });
  queue.handleNodeReady('node-b');
  await settle(queue);
  assert.equal(queue.current?.encoded, 'one-node-b');
  assert.equal(queue.state, 'PLAYING');
  assert.deepEqual(player.played, ['one', 'one-node-b']);
  queue.dispose();
});

test('one hundred queued tracks survive concurrent skip pressure without duplicate playback', async () => {
  const { queue, player } = createQueue();
  const tracks = Array.from({ length: 100 }, (_, index) => makeTrack(`track-${index + 1}`));
  await queue.enqueueMany(tracks);

  await Promise.all(Array.from({ length: 99 }, () => queue.skip()));

  assert.equal(queue.current?.encoded, 'track-100');
  assert.equal(queue.tracks.length, 0);
  assert.equal(queue.history.length, 50);
  assert.equal(queue.history[0]?.encoded, 'track-50');
  assert.equal(queue.history[49]?.encoded, 'track-99');
  assert.deepEqual(player.played, tracks.map((track) => track.encoded));
  queue.dispose();
});

test('previous restores history and preserves the interrupted current track at the queue front', async () => {
  const { queue, player } = createQueue();
  await queue.enqueueMany([makeTrack('one'), makeTrack('two'), makeTrack('three')]);
  await queue.skip();
  await queue.previous();

  assert.equal(queue.current?.encoded, 'one');
  assert.deepEqual(queue.tracks.map((track) => track.encoded), ['two', 'three']);
  assert.deepEqual(player.played, ['one', 'two', 'one']);
  queue.dispose();
});

test('jump selects one queue item while preserving every other queued track in order', async () => {
  const { queue, player } = createQueue();
  await queue.enqueueMany([makeTrack('one'), makeTrack('two'), makeTrack('three'), makeTrack('four')]);
  assert.equal(await queue.jumpTo(1), true);

  assert.equal(queue.current?.encoded, 'three');
  assert.deepEqual(queue.tracks.map((track) => track.encoded), ['two', 'four']);
  assert.deepEqual(queue.history.map((track) => track.encoded), ['one']);
  assert.deepEqual(player.played, ['one', 'three']);
  queue.dispose();
});

test('player command failures reject their caller while the serialized queue remains usable', async () => {
  const { queue, player } = createQueue();
  player.failVolume = true;
  await assert.rejects(queue.setVolume(80), /volume rejected/);
  player.failVolume = false;
  await queue.setVolume(70);
  assert.equal(player.volume, 70);
  queue.dispose();
});

test('pause and resume reject stale controls when there is no current track', async () => {
  const { queue } = createQueue();
  await assert.rejects(queue.setPaused(true), /Tidak ada lagu/);
  queue.dispose();
});

test('panel controls acknowledge immediately and mutate volume, pause, seek, loop, filter, shuffle, and clear safely', async () => {
  const { queue, player, guild } = createQueue();
  await queue.enqueueMany([makeTrack('one'), makeTrack('two'), makeTrack('three'), makeTrack('four')]);

  const run = async (id: string, values: string[] = []) => {
    const interaction = makeControlInteraction(guild, id, values);
    await queue.handleControlInteraction(interaction as never);
    assert.equal(interaction.deferred, true, `${id} must acknowledge the interaction first`);
  };

  await run('music:pause');
  assert.equal(player.paused, true);
  await run('music:resume');
  assert.equal(player.paused, false);

  await run('music:volume-down');
  assert.equal(player.volume, 90);
  await run('music:volume-up');
  assert.equal(player.volume, 100);
  await run('music:mute');
  assert.equal(player.volume, 0);
  await run('music:mute');
  assert.equal(player.volume, 100);

  player.position = 50000;
  await run('music:seek-back');
  assert.equal(player.position, 40000);
  await run('music:seek-forward');
  assert.equal(player.position, 50000);

  await run('music:loop');
  assert.equal(queue.loop, 'TRACK');
  await run('music:filter-select', ['bassboost']);
  assert.deepEqual(player.filterCalls, ['clear', 'equalizer']);

  const beforeShuffle = [...queue.tracks].map((track) => track.encoded).sort();
  await run('music:shuffle');
  assert.deepEqual(queue.tracks.map((track) => track.encoded).sort(), beforeShuffle);
  await run('music:clear');
  assert.equal(queue.tracks.length, 0);
  queue.dispose();
});

test('manual disconnect leaves voice, removes the queue, and cancels all background timers', async () => {
  const { queue, client, getLeaveCalls } = createQueue();
  client.queues.set('guild', queue);
  const service = playbackSessionService as unknown as {
    markDisconnecting: (guildId: string) => Promise<void>;
    delete: (guildId: string) => Promise<void>;
  };
  const originalMark = service.markDisconnecting;
  const originalDelete = service.delete;
  service.markDisconnecting = async () => undefined;
  service.delete = async () => undefined;

  try {
    await queue.enqueue(makeTrack('one'));
    queue.scheduleControlPanelRefresh(10000);
    await queue.disconnect();
    const internals = queue as unknown as {
      disposed: boolean;
      checkpointTimer: NodeJS.Timeout | null;
      panelTimer: NodeJS.Timeout | null;
      recoveryTimer: NodeJS.Timeout | null;
    };
    assert.equal(getLeaveCalls(), 1);
    assert.equal(client.queues.has('guild'), false);
    assert.equal(internals.disposed, true);
    assert.equal(internals.checkpointTimer, null);
    assert.equal(internals.panelTimer, null);
    assert.equal(internals.recoveryTimer, null);
  } finally {
    service.markDisconnecting = originalMark;
    service.delete = originalDelete;
  }
});
