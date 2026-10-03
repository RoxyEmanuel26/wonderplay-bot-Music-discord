import { after, describe, it } from 'node:test';
import * as assert from 'node:assert';
import { checkCooldown, CooldownStore } from './cooldown';
import { redis } from '../database/redis';

after(() => redis.disconnect());

function createStore(): CooldownStore {
  const entries = new Map<string, number>();
  return {
    async set(key, _value, _px, durationMs) {
      const now = Date.now();
      const expiresAt = entries.get(key) || 0;
      if (expiresAt > now) return null;
      entries.set(key, now + durationMs);
      return 'OK';
    },
  };
}

describe('Cooldown System', () => {
  it('should allow first request and block second immediate request', async () => {
    const store = createStore();
    const userId = 'test_user_1';
    const commandName = 'play';
    
    // Request 1: should be allowed (isSpamming = false)
    const req1 = await checkCooldown(userId, commandName, 5000, store);
    assert.strictEqual(req1, false, 'First request should be allowed');
    
    // Request 2: should be blocked (isSpamming = true)
    const req2 = await checkCooldown(userId, commandName, 5000, store);
    assert.strictEqual(req2, true, 'Second immediate request should be blocked');
  });

  it('should allow request after cooldown expires', async () => {
    const store = createStore();
    const userId = 'test_user_2';
    const commandName = 'play';
    
    // Request 1
    await checkCooldown(userId, commandName, 500, store); // 500ms cooldown
    
    // Wait for 600ms
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Request 2: should be allowed because 500ms passed
    const req2 = await checkCooldown(userId, commandName, 500, store);
    assert.strictEqual(req2, false, 'Request after cooldown should be allowed');
  });

  it('fails open quickly when the cache does not answer', async () => {
    const neverResponds: CooldownStore = {
      set: async () => new Promise<string | null>(() => undefined),
    };
    const startedAt = Date.now();
    const blocked = await checkCooldown('test_user_3', 'play', 5000, neverResponds);
    assert.strictEqual(blocked, false);
    assert.ok(Date.now() - startedAt < 1000, 'Cooldown fallback should not consume Discord interaction timeout');
  });
});
