import type { DownloadJob, UserIdentity } from '../types.js';

export function assertJobBelongsToUser(job: DownloadJob | undefined, user: UserIdentity): DownloadJob {
  if (!job) {
    const error = new Error('That download is no longer available.');
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  if (job.userId !== user.id) {
    const error = new Error('That download belongs to another signed-in person.');
    Object.assign(error, { statusCode: 403 });
    throw error;
  }

  return job;
}

export function isExpired(job: Pick<DownloadJob, 'expiresAt'>, now = Date.now()): boolean {
  return job.expiresAt <= now;
}
