import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { checkCooldown } from './cooldown';
import { redis } from '../database/redis';

describe('Cooldown System', () => {
  it('should allow first request and block second immediate request', async () => {
    const userId = 'test_user_1';
    const commandName = 'play';
    
    // Clear initial state just in case
    await redis.del(`cooldown:${commandName}:${userId}`);
    
    // Request 1: should be allowed (isSpamming = false)
    const req1 = await checkCooldown(userId, commandName, 5000);
    assert.strictEqual(req1, false, 'First request should be allowed');
    
    // Request 2: should be blocked (isSpamming = true)
    const req2 = await checkCooldown(userId, commandName, 5000);
    assert.strictEqual(req2, true, 'Second immediate request should be blocked');
    
    // Cleanup
    await redis.del(`cooldown:${commandName}:${userId}`);
  });

  it('should allow request after cooldown expires', async () => {
    const userId = 'test_user_2';
    const commandName = 'play';
    
    await redis.del(`cooldown:${commandName}:${userId}`);
    
    // Request 1
    await checkCooldown(userId, commandName, 500); // 500ms cooldown
    
    // Wait for 600ms
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Request 2: should be allowed because 500ms passed
    const req2 = await checkCooldown(userId, commandName, 500);
    assert.strictEqual(req2, false, 'Request after cooldown should be allowed');
    
    // Cleanup
    await redis.del(`cooldown:${commandName}:${userId}`);
    redis.disconnect(); // Close connection
  });
});
