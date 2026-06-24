import { describe, expect, it } from 'vitest';
import { assertJobBelongsToUser, isExpired } from '../services/jobPolicy.js';
import type { DownloadJob, UserIdentity } from '../types.js';

const user: UserIdentity = { id: 'user-a', email: 'a@example.com', source: 'cloudflare' };
const other: UserIdentity = { id: 'user-b', email: 'b@example.com', source: 'cloudflare' };

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  const now = Date.now();
  return {
    id: 'job-1',
    userId: user.id,
    url: 'https://example.com/video',
    mode: 'video',
    quality: 'best',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 1000,
    downloadToken: 'token',
    ...overrides
  };
}

describe('job policy', () => {
  it('allows the owner to access their job', () => {
    expect(assertJobBelongsToUser(job(), user).id).toBe('job-1');
  });

  it('prevents one user from accessing another user job', () => {
    expect(() => assertJobBelongsToUser(job(), other)).toThrow(/another signed-in person/);
  });

  it('marks expired jobs by timestamp', () => {
    expect(isExpired(job({ expiresAt: Date.now() - 1 }))).toBe(true);
    expect(isExpired(job({ expiresAt: Date.now() + 60_000 }))).toBe(false);
  });
});
