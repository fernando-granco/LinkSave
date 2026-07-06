import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { config } from '../config.js';
import type { UserIdentity, VideoMetadata } from '../types.js';

const requestKey = (id: string) => `fd:inspect:req:${id}`;
const resultKey = (id: string) => `fd:inspect:result:${id}`;
const metadataKey = (url: string) => `fd:meta:${createHash('sha256').update(url).digest('hex')}`;
export const inspectQueueKey = 'fd:queue:inspect';

// Cache successful inspections briefly so a download that follows a preview
// does not have to inspect the same URL twice.
const METADATA_CACHE_SECONDS = 600;

export async function cacheMetadata(redis: Redis, url: string, metadata: VideoMetadata): Promise<void> {
  await redis.set(metadataKey(url), JSON.stringify(metadata), 'EX', METADATA_CACHE_SECONDS);
}

export async function readCachedMetadata(redis: Redis, url: string): Promise<VideoMetadata | undefined> {
  const raw = await redis.get(metadataKey(url));
  return raw ? (JSON.parse(raw) as VideoMetadata) : undefined;
}

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
