import { Redis } from 'ioredis';
import { config } from '../config.js';

export function createRedis(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
}
