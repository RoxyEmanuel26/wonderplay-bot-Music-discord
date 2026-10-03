import assert from 'node:assert/strict';
import test from 'node:test';
import type { NodeOption } from 'shoukaku';
import { AureliaClient } from './AureliaClient';
import { LavalinkNodeRanker, lavalinkSource } from './LavalinkNodeRanker';
import { PUBLIC_LAVALINK_NODES } from '../config/lavalinkNodes';

interface FakeNode {
  state: number;
  sessionId: string | null;
  connect(): Promise<void>;
}

interface ReconnectHarness {
  shoukaku: {
    nodes: Map<string, FakeNode>;
    addNode(config: NodeOption): void;
  };
  lavalinkNodeConfigs: Map<string, NodeOption>;
  runNodeReconnectCycle(name: string): Promise<void>;
  isLavalinkNodeHealthy(name: string): boolean;
  compareLavalinkNodes(a: { name: string; penalties: number }, b: { name: string; penalties: number }, source?: string): number;
}

function harness() {
  return new AureliaClient() as unknown as ReconnectHarness;
}

const nodeConfig: NodeOption = {
  name: 'Node-2 (MilloHost-ID)',
  url: 'public.example:443',
  auth: 'public-test',
  secure: true,
};

test('public-only node list never registers a configured private Lavalink server', () => {
  assert.equal(PUBLIC_LAVALINK_NODES.length, 4);
  assert.ok(PUBLIC_LAVALINK_NODES.every((node) => node.name !== 'Node-1 (Custom/Local)'));
  assert.ok(PUBLIC_LAVALINK_NODES.every((node) => !node.name.includes('TriniumHost')));
  assert.ok(PUBLIC_LAVALINK_NODES.every((node) => !node.url.includes('localhost')));
  assert.deepEqual(PUBLIC_LAVALINK_NODES.map((node) => node.name), [
    'Node-3 (Serenetia-Global)',
    'Node-7 (Jirayu-TLS)',
    'Node-2 (MilloHost-ID)',
    'Node-6 (Serenetia-HTTP)',
  ]);
});

test('watchdog recreates a Lavalink node removed after Shoukaku exhausts retries', async () => {
  const client = harness();
  const nodes = new Map<string, FakeNode>();
  let added: NodeOption | undefined;
  client.shoukaku = {
    nodes,
    addNode(config) {
      added = config;
      nodes.set(config.name, { state: 1, sessionId: 'session-added', connect: async () => undefined });
    },
  };
  client.lavalinkNodeConfigs = new Map([[nodeConfig.name, nodeConfig]]);

  await client.runNodeReconnectCycle(nodeConfig.name);

  assert.deepEqual(added, nodeConfig);
  assert.equal(nodes.get(nodeConfig.name)?.state, 1);
});

test('watchdog reconnects an existing disconnected Lavalink node', async () => {
  const client = harness();
  let attempts = 0;
  const node: FakeNode = {
    state: 3,
    sessionId: null,
    async connect() {
      attempts++;
      this.state = 1;
      this.sessionId = 'session-reconnected';
    },
  };
  client.shoukaku = {
    nodes: new Map([[nodeConfig.name, node]]),
    addNode() {
      throw new Error('node must not be recreated while it still exists');
    },
  };
  client.lavalinkNodeConfigs = new Map([[nodeConfig.name, nodeConfig]]);

  await client.runNodeReconnectCycle(nodeConfig.name);

  assert.equal(attempts, 1);
  assert.equal(node.state, 1);
});

test('CONNECTED is not healthy until Lavalink supplies a session id', () => {
  const client = harness();
  const node: FakeNode = {
    state: 1,
    sessionId: null,
    connect: async () => undefined,
  };
  client.shoukaku = {
    nodes: new Map([[nodeConfig.name, node]]),
    addNode() {},
  };

  assert.equal(client.isLavalinkNodeHealthy(nodeConfig.name), false);
  node.sessionId = 'ready-session';
  assert.equal(client.isLavalinkNodeHealthy(nodeConfig.name), true);
});

test('TLS public nodes are preferred over plaintext public nodes', () => {
  const client = harness();
  client.lavalinkNodeConfigs = new Map([
    [nodeConfig.name, nodeConfig],
    ['public-http', { name: 'public-http', url: 'example.com:4333', auth: 'free', secure: false }],
  ]);
  const sorted = [
    { name: 'public-http', penalties: 0 },
    { name: nodeConfig.name, penalties: 20 },
  ].sort((a, b) => client.compareLavalinkNodes(a, b));

  assert.deepEqual(sorted.map((node) => node.name), [nodeConfig.name, 'public-http']);
});

test('public node preference is Serenetia, Jirayu, then MilloHost until failures change the score', () => {
  const client = harness() as ReconnectHarness & { recordLavalinkPlaybackFailure(name: string, source: string): void };
  const configs = PUBLIC_LAVALINK_NODES.filter((node) => node.secure);
  client.lavalinkNodeConfigs = new Map(configs.map((node) => [node.name, node]));
  const nodes = configs.map((node) => ({ name: node.name, penalties: 0 }));

  assert.deepEqual(nodes.sort((a, b) => client.compareLavalinkNodes(a, b)).map((node) => node.name), [
    'Node-3 (Serenetia-Global)', 'Node-7 (Jirayu-TLS)', 'Node-2 (MilloHost-ID)',
  ]);
  client.recordLavalinkPlaybackFailure('Node-3 (Serenetia-Global)', 'youtube');
  assert.equal(nodes.sort((a, b) => client.compareLavalinkNodes(a, b, 'youtube'))[0].name, 'Node-7 (Jirayu-TLS)');
});

test('a YouTube stream failure makes another TLS node preferable without penalizing Spotify', () => {
  const ranker = new LavalinkNodeRanker();
  const firstNode = { name: nodeConfig.name, penalties: 0, secure: true, sources: ['youtube', 'spotify'] };
  const secondNode = { name: 'public-tls', penalties: 5, secure: true, sources: ['youtube', 'spotify'] };
  assert.ok(ranker.score(firstNode, 'youtube') < ranker.score(secondNode, 'youtube'));

  ranker.failure(firstNode.name, 'youtube');
  assert.ok(ranker.score(firstNode, 'youtube') > ranker.score(secondNode, 'youtube'));
  assert.ok(ranker.score(firstNode, 'spotify') < ranker.score(secondNode, 'spotify'));

  ranker.success(firstNode.name, 'youtube');
  assert.ok(ranker.score(firstNode, 'youtube') < ranker.score(secondNode, 'youtube'));
});

test('source support and stale failures influence node order', () => {
  const ranker = new LavalinkNodeRanker();
  const missingSpotify = { name: 'public-no-spotify', penalties: 0, secure: true, sources: ['youtube'] };
  const spotifyNode = { name: 'public-spotify', penalties: 20, secure: true, sources: ['spotify'] };
  assert.ok(ranker.score(spotifyNode, 'spotify') < ranker.score(missingSpotify, 'spotify'));
  assert.equal(lavalinkSource('ytmsearch:lagu sedih'), 'youtube');
  assert.equal(lavalinkSource('https://open.spotify.com/track/123'), 'spotify');
  ranker.failure(spotifyNode.name, 'spotify', 1000);
  assert.ok(ranker.score(spotifyNode, 'spotify', 1000) > ranker.score(spotifyNode, 'spotify', 11 * 60 * 1000));
});

test('resolve retries YouTube on another node and avoids the failed source on the next request', async () => {
  const client = new AureliaClient();
  const calls: string[] = [];
  const track = {
    encoded: 'public-encoded',
    info: { identifier: 'video', isSeekable: true, author: 'Artist', length: 180000,
      isStream: false, position: 0, title: 'Song', uri: 'https://youtube.com/watch?v=video', sourceName: 'youtube' },
    pluginInfo: {},
  };
  const firstNode = {
    name: nodeConfig.name, state: 1, sessionId: 'first-session', penalties: 0,
    info: { sourceManagers: ['youtube', 'spotify'] },
    rest: { async resolve() { calls.push('first'); throw new Error('stream unavailable'); } },
  };
  const publicNode = {
    name: 'public-tls', state: 1, sessionId: 'public-session', penalties: 0,
    info: { sourceManagers: ['youtube'] },
    rest: { async resolve() { calls.push('public'); return { loadType: 'track', data: track }; } },
  };
  (client as unknown as { shoukaku: unknown }).shoukaku = {
    nodes: new Map([[firstNode.name, firstNode], [publicNode.name, publicNode]]),
  };
  (client as unknown as { lavalinkNodeConfigs: Map<string, NodeOption> }).lavalinkNodeConfigs = new Map([
    [firstNode.name, nodeConfig],
    [publicNode.name, { name: publicNode.name, url: 'example.com:443', auth: 'free', secure: true }],
  ]);

  const first = await client.resolveTrack('ytsearch:Song');
  const second = await client.resolveTrack('ytsearch:Song');

  assert.deepEqual(calls, ['first', 'public', 'public']);
  assert.equal(first?.node.name, 'public-tls');
  assert.equal(second?.node.name, 'public-tls');
  assert.equal((first?.result.data as typeof track).pluginInfo &&
    ((first?.result.data as typeof track).pluginInfo as { encodedNode?: string }).encodedNode, 'public-tls');
});
