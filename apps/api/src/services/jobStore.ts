import type { Redis } from 'ioredis';
import type { DownloadJob, PublicJob } from '../types.js';

const jobKey = (id: string) => `fd:job:${id}`;
const activeUserKey = (userId: string) => `fd:active:user:${userId}`;
const activeGlobalKey = 'fd:active:global';

export type SlotReservation = 'ok' | 'global-full' | 'user-full';

// Reserve a concurrency slot atomically. Active jobs are tracked in sorted sets
// scored by their expiry time, so a slot left behind by a crashed worker is
// auto-pruned once the job would have expired (it can never wedge the limiter).
// KEYS: jobKey, activeGlobalKey, activeUserKey
// ARGV: jobJson, jobId, ttlSeconds, maxGlobal, maxUser, nowMs, expiresAtMs
const RESERVE_SLOT_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[6])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[6])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 'global-full' end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) then return 'user-full' end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[7], ARGV[2])
redis.call('ZADD', KEYS[3], ARGV[7], ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return 'ok'
`;

export class JobStore {
  constructor(
    private readonly redis: Redis,
    private readonly expirationSeconds: number
  ) {}

  async reserveSlot(
    job: DownloadJob,
    maxGlobal: number,
    maxUser: number
  ): Promise<SlotReservation> {
    const result = await this.redis.eval(
      RESERVE_SLOT_LUA,
      3,
      jobKey(job.id),
      activeGlobalKey,
      activeUserKey(job.userId),
      JSON.stringify(job),
      job.id,
      String(this.expirationSeconds),
      String(maxGlobal),
      String(maxUser),
      String(Date.now()),
      String(job.expiresAt)
    );
    return result as SlotReservation;
  }

  async get(id: string): Promise<DownloadJob | undefined> {
    const raw = await this.redis.get(jobKey(id));
    return raw ? (JSON.parse(raw) as DownloadJob) : undefined;
  }

  /**
   * Persist progress for a job that already exists. Uses SET ... XX so a job that
   * was cancelled or expired (its key deleted) is never resurrected. Returns
   * false when the job is gone, letting the worker stop and clean up.
   */
  async save(job: DownloadJob): Promise<boolean> {
    job.updatedAt = Date.now();
    const ttl = Math.max(1, Math.ceil((job.expiresAt - Date.now()) / 1000));
    const result = await this.redis.set(jobKey(job.id), JSON.stringify(job), 'EX', ttl, 'XX');
    return result === 'OK';
  }

  async markInactive(job: DownloadJob): Promise<void> {
    await this.redis
      .multi()
      .zrem(activeGlobalKey, job.id)
      .zrem(activeUserKey(job.userId), job.id)
      .exec();
  }

  async delete(job: DownloadJob): Promise<void> {
    await this.redis
      .multi()
      .del(jobKey(job.id))
      .zrem(activeGlobalKey, job.id)
      .zrem(activeUserKey(job.userId), job.id)
      .exec();
  }

  publicJob(job: DownloadJob): PublicJob {
    const ready = job.status === 'ready' && Boolean(job.downloadToken);
    return {
      id: job.id,
      status: job.status,
      mode: job.mode,
      quality: job.quality,
      metadata: job.metadata,
      errorMessage: job.errorMessage,
      downloadUrl: ready
        ? `/download/${job.id}?token=${encodeURIComponent(job.downloadToken)}`
        : undefined,
      expiresAt: job.expiresAt
    };
  }
}
