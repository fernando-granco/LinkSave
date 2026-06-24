import { nanoid } from 'nanoid';
import type { Redis } from 'ioredis';
import { config } from '../config.js';
import type { UserIdentity, VideoMetadata } from '../types.js';

const requestKey = (id: string) => `fd:inspect:req:${id}`;
const resultKey = (id: string) => `fd:inspect:result:${id}`;
export const inspectQueueKey = 'fd:queue:inspect';

export interface InspectResult {
  ok: boolean;
  metadata?: VideoMetadata;
  errorMessage?: string;
}

export async function requestInspection(
  redis: Redis,
  user: UserIdentity,
  url: string
): Promise<VideoMetadata> {
  const id = nanoid(24);
  await redis
    .multi()
    .set(requestKey(id), JSON.stringify({ id, userId: user.id, url }), 'EX', 60)
    .lpush(inspectQueueKey, id)
    .exec();

  const deadline = Date.now() + config.inspectTimeoutMs;
  while (Date.now() < deadline) {
    const raw = await redis.get(resultKey(id));
    if (raw) {
      await redis.del(resultKey(id), requestKey(id));
      const result = JSON.parse(raw) as InspectResult;
      if (result.ok && result.metadata) return result.metadata;
      throw new Error(result.errorMessage || 'I could not read that link.');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error('Checking that link took too long. Please try again in a moment.');
}

export async function readInspectRequest(
  redis: Redis,
  id: string
): Promise<{ id: string; userId: string; url: string } | undefined> {
  const raw = await redis.get(requestKey(id));
  return raw ? JSON.parse(raw) : undefined;
}

export async function writeInspectResult(redis: Redis, id: string, result: InspectResult): Promise<void> {
  await redis.set(resultKey(id), JSON.stringify(result), 'EX', 60);
}
