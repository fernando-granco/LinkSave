import pino from 'pino';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { createRedis } from './services/redis.js';
import { JobStore } from './services/jobStore.js';
import { downloadQueueKey } from './services/downloadQueue.js';
import {
  inspectQueueKey,
  readInspectRequest,
  writeInspectResult,
  cacheMetadata,
  readCachedMetadata
} from './services/inspectQueue.js';
import { inspectWithYtDlp, downloadWithYtDlp, removeJobTempFiles } from './services/ytDlp.js';
import { scheduleYtDlpUpdates } from './services/ytDlpUpdater.js';
import { assertPublicUrl } from './services/urlSafety.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const redis = createRedis();
const store = new JobStore(redis, config.jobExpirationSeconds);

export const heartbeatPath = path.join(config.tempDir, '.worker-heartbeat');

/** Thrown when a job vanished mid-processing (cancelled or expired). */
class JobGoneError extends Error {}

async function processInspect(id: string): Promise<void> {
  const request = await readInspectRequest(redis, id);
  if (!request) return;

  try {
    // Re-validate the URL in the worker: the API already checked it, but the
    // worker is the process that actually reaches the network.
    await assertPublicUrl(request.url);
    const metadata = await inspectWithYtDlp(request.url);
    await cacheMetadata(redis, request.url, metadata);
    await writeInspectResult(redis, id, { ok: true, metadata });
  } catch (error) {
    await writeInspectResult(redis, id, {
      ok: false,
      errorMessage: error instanceof Error ? error.message : 'I could not read that link.'
    });
  }
}

async function processDownload(id: string): Promise<void> {
  const job = await store.get(id);
  if (!job) return;

  // Persist progress, but stop immediately if the job was cancelled/expired so
  // we never resurrect a deleted job or leave its file on disk.
  const persist = async (): Promise<void> => {
    if (!(await store.save(job))) throw new JobGoneError();
  };

  try {
    await assertPublicUrl(job.url);

    // Reuse a recent preview's metadata (duration limit was already checked
    // there) instead of inspecting the same URL twice.
    if (!job.metadata) {
      job.metadata = await readCachedMetadata(redis, job.url);
    }

    job.status = 'downloading';
    await persist();

    const result = await downloadWithYtDlp(job);

    job.status = 'ready';
    job.metadata = result.metadata;
    job.filePath = result.filePath;
    job.fileName = result.fileName;
    job.fileSize = result.fileSize;
    job.mimeType = result.mimeType;
    await persist();
    await store.markInactive(job);
  } catch (error) {
    await removeJobTempFiles(job.id);
    await store.markInactive(job);
    if (error instanceof JobGoneError) {
      logger.info({ jobId: job.id }, 'job cancelled during processing');
      return;
    }
    job.status = 'failed';
    job.errorMessage = error instanceof Error ? error.message : 'The download could not be finished.';
    // Best-effort: only record the failure if the job still exists.
    await store.save(job);
    logger.warn({ jobId: job.id }, 'download failed');
  }
}

async function writeHeartbeat(): Promise<void> {
  try {
    await fs.writeFile(heartbeatPath, String(Date.now()));
  } catch (error) {
    logger.warn({ err: error }, 'failed to write heartbeat');
  }
}

async function startMaintenance(): Promise<void> {
  await fs.mkdir(config.tempDir, { recursive: true });

  // On startup, clear any temp files left by a previous run: their jobs no
  // longer exist (Redis keys carry short TTLs), so the files are orphans.
  try {
    const entries = await fs.readdir(config.tempDir);
    await Promise.all(
      entries
        .filter((entry) => entry !== path.basename(heartbeatPath))
        .map((entry) => fs.rm(path.join(config.tempDir, entry), { force: true }))
    );
  } catch (error) {
    logger.warn({ err: error }, 'startup temp sweep failed');
  }

  await writeHeartbeat();
  setInterval(() => void writeHeartbeat(), 10_000).unref();

  // Safety net: delete any temp file older than the job lifetime, covering
  // crashes that skipped the normal per-job cleanup.
  setInterval(async () => {
    const cutoff = Date.now() - config.jobExpirationSeconds * 1000;
    try {
      const entries = await fs.readdir(config.tempDir);
      await Promise.all(
        entries
          .filter((entry) => entry !== path.basename(heartbeatPath))
          .map(async (entry) => {
            const filePath = path.join(config.tempDir, entry);
            const stat = await fs.stat(filePath);
            if (stat.mtimeMs < cutoff) await fs.rm(filePath, { force: true });
          })
      );
    } catch (error) {
      logger.warn({ err: error }, 'cleanup failed');
    }
  }, config.cleanupIntervalSeconds * 1000).unref();
}

/**
 * Consume one queue forever on its own dedicated Redis connection (BRPOP blocks
 * the connection it runs on, so each loop needs its own). Inspections and
 * downloads run in separate loops so a long download never delays link
 * previews for other users.
 */
async function runQueueLoop(queueKey: string, handler: (id: string) => Promise<void>): Promise<never> {
  const connection = createRedis();
  while (true) {
    try {
      const item = await connection.brpop(queueKey, 5);
      if (!item) continue;
      await handler(item[1]);
    } catch (error) {
      logger.error({ err: error, queue: queueKey }, 'unexpected worker error');
      // Brief pause so a persistent failure (e.g. Redis down) cannot hot-loop.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await startMaintenance();
  scheduleYtDlpUpdates(logger);
  logger.info('worker started');
  await Promise.all([
    runQueueLoop(inspectQueueKey, processInspect),
    runQueueLoop(downloadQueueKey, processDownload)
  ]);
}

main().catch((error) => {
  logger.error({ err: error }, 'worker crashed');
  process.exit(1);
});
