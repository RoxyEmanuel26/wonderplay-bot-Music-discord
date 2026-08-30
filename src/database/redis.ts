import Redis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Inisialisasi Redis dengan pengaturan reconnection agar bot tidak mati jika redis mati
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Berhasil tersambung ke Redis Cache Database!');
});

redis.on('error', (err) => {
  logger.warn(`Koneksi Redis error/terputus: ${err.message}. Cache akan dilewati.`);
});
