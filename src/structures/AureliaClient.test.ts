import assert from 'node:assert/strict';
import test from 'node:test';
import type { NodeOption } from 'shoukaku';
import { AureliaClient } from './AureliaClient';

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
}

function harness() {
  return new AureliaClient() as unknown as ReconnectHarness;
}

const nodeConfig: NodeOption = {
  name: 'Node-1 (Custom/Local)',
  url: 'localhost:19135',
  auth: 'secret',
  secure: false,
};

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
