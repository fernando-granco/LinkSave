import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { JobStore } from '../services/jobStore.js';
import type { DownloadJob } from '../types.js';

// publicJob is pure, so a stub Redis is enough to exercise it.
const store = new JobStore({} as unknown as Redis, 900);

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  const now = Date.now();
  return {
    id: 'job-1',
    userId: 'user-a',
    url: 'https://example.com/video',
    mode: 'video',
    quality: 'best',
    allowHighRes: false,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 900_000,
    downloadToken: 'secret-token',
    ...overrides
  };
}

describe('publicJob projection', () => {
  it('never leaks internal fields', () => {
    const view = store.publicJob(job({ filePath: '/data/media/job-1.mp4', url: 'https://x' }));
    expect(view).not.toHaveProperty('url');
    expect(view).not.toHaveProperty('filePath');
    expect(view).not.toHaveProperty('userId');
    expect(view).not.toHaveProperty('downloadToken');
  });

  it('only exposes a download URL once the job is ready', () => {
    expect(store.publicJob(job({ status: 'queued' })).downloadUrl).toBeUndefined();
    expect(store.publicJob(job({ status: 'downloading' })).downloadUrl).toBeUndefined();
    expect(store.publicJob(job({ status: 'failed' })).downloadUrl).toBeUndefined();

    const ready = store.publicJob(job({ status: 'ready' }));
    expect(ready.downloadUrl).toBe('/download/job-1?token=secret-token');
  });
});
