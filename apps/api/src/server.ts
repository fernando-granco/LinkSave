import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { config } from './config.js';
import { requireIdentity, getIdentity, resolveIdentity } from './auth.js';
import { createRedis } from './services/redis.js';
import { JobStore } from './services/jobStore.js';
import { assertJobBelongsToUser, isExpired } from './services/jobPolicy.js';
import { assertPublicUrl } from './services/urlSafety.js';
import { isQualityAllowed } from './services/formatPresets.js';
import { requestInspection } from './services/inspectQueue.js';
import { downloadQueueKey } from './services/downloadQueue.js';
import { removeJobTempFiles } from './services/ytDlp.js';
import type { DownloadJob, DownloadMode, Quality } from './types.js';

const redis = createRedis();
const store = new JobStore(redis, config.jobExpirationSeconds);

const bodySchema = z.object({
  url: z.string().min(8).max(4096)
});

const createJobSchema = bodySchema.extend({
  mode: z.enum(['video', 'audio']),
  quality: z.enum(['best', '1080p', '720p', '480p', 'm4a', 'mp3-128', 'mp3-192', 'mp3-320']),
  // Opt-in 4K for "best" video; ignored for fixed resolutions and audio.
  allowHighRes: z.boolean().optional().default(false)
});

const jobIdSchema = z.object({ id: z.string().min(8).max(64) });

/**
 * Build a safe attachment Content-Disposition header. The ASCII fallback drops
 * quotes, backslashes and any non-printable byte (no header injection / no
 * breaking out of the quoted value), and a UTF-8 `filename*` keeps accented
 * titles readable in modern browsers.
 */
function contentDisposition(fileName: string): string {
  const asciiFallback =
    Array.from(fileName)
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        return char === '"' || char === '\\' || code < 0x20 || code > 0x7e ? '_' : char;
      })
      .join('')
      .trim() || 'download';
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16)}`
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function publicDir(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.join(current, 'public');
}

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.cf-access-jwt-assertion']
    }
  });

  await app.register(cors, { origin: false });

  // Resolve identity once, before the rate limiter keys on it. Verifying the
  // Cloudflare Access JWT here means handlers and the limiter share one result.
  app.addHook('onRequest', async (request) => {
    await resolveIdentity(request);
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    keyGenerator: (request) => {
      const identity = getIdentity(request);
      return `${identity?.id || 'anonymous'}:${request.ip}`;
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number((error as Error & { statusCode?: number }).statusCode || 500);
    // Keep full detail in server logs; only show generic text for server errors.
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    }
    const errorMessage = error instanceof Error ? error.message : 'Something went wrong.';
    const message =
      statusCode >= 500 ? 'Something went wrong. Please try again in a moment.' : errorMessage;
    reply.status(statusCode).send({ error: message });
  });

  app.addHook('preHandler', async (request) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/download/')) {
      requireIdentity(request);
    }
  });

  // Health reflects readiness: the API is only useful when Redis is reachable.
  app.get('/health', async (_request, reply) => {
    try {
      await redis.ping();
      return { ok: true };
    } catch {
      reply.status(503);
      return { ok: false };
    }
  });

  // Tells the UI which optional features to show (e.g. whether to offer 4K).
  app.get('/api/options', async (request) => {
    requireIdentity(request);
    return { allow4k: config.allow4k };
  });

  app.post('/api/inspect', async (request) => {
    const user = requireIdentity(request);
    const body = bodySchema.parse(request.body);
    const url = await assertPublicUrl(body.url);
    const metadata = await requestInspection(redis, user, url.toString());
    return { metadata };
  });

  app.post('/api/jobs', async (request, reply) => {
    const user = requireIdentity(request);
    const body = createJobSchema.parse(request.body);
    if (!isQualityAllowed(body.mode as DownloadMode, body.quality as Quality)) {
      reply.status(400);
      return { error: 'Please choose a matching download option.' };
    }

    const url = await assertPublicUrl(body.url);

    const now = Date.now();
    const job: DownloadJob = {
      id: nanoid(32),
      userId: user.id,
      url: url.toString(),
      mode: body.mode as DownloadMode,
      quality: body.quality as Quality,
      // 4K is enforced server-side: ignore the client's request when disabled.
      allowHighRes: config.allow4k && body.allowHighRes,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + config.jobExpirationSeconds * 1000,
      downloadToken: nanoid(48)
    };

    // Atomically reserve a concurrency slot so two simultaneous requests cannot
    // both pass the limit check (TOCTOU). The slot is released by the worker
    // (markInactive) or on job deletion.
    const reservation = await store.reserveSlot(
      job,
      config.maxGlobalConcurrentJobs,
      config.maxConcurrentJobsPerUser
    );
    if (reservation === 'global-full') {
      reply.status(429);
      return { error: 'The downloader is busy right now. Please try again in a minute.' };
    }
    if (reservation === 'user-full') {
      reply.status(429);
      return { error: 'One download at a time, please. Your current download will be ready soon.' };
    }

    await redis.lpush(downloadQueueKey, job.id);
    reply.status(202);
    return { job: store.publicJob(job) };
  });

  app.get('/api/jobs/:id', async (request) => {
    const user = requireIdentity(request);
    const params = jobIdSchema.parse(request.params);
    const job = assertJobBelongsToUser(await store.get(params.id), user);
    if (isExpired(job)) {
      job.status = 'expired';
      await store.delete(job);
      await removeJobTempFiles(job.id);
      return { job: store.publicJob(job) };
    }
    return { job: store.publicJob(job) };
  });

  app.delete('/api/jobs/:id', async (request) => {
    const user = requireIdentity(request);
    const params = jobIdSchema.parse(request.params);
    const job = assertJobBelongsToUser(await store.get(params.id), user);
    // Delete the job record first so an in-flight worker cannot resurrect it
    // (worker saves use SET ... XX), then remove any partial/finished files.
    await store.delete(job);
    await removeJobTempFiles(job.id);
    return { ok: true };
  });

  app.get('/download/:id', async (request, reply) => {
    const user = requireIdentity(request);
    const params = jobIdSchema.parse(request.params);
    const query = z.object({ token: z.string().min(16).max(128) }).parse(request.query);
    const job = assertJobBelongsToUser(await store.get(params.id), user);

    if (job.status !== 'ready' || query.token !== job.downloadToken || !job.filePath || !job.fileName) {
      reply.status(404);
      return { error: 'That download is no longer available.' };
    }

    if (isExpired(job)) {
      await store.delete(job);
      await removeJobTempFiles(job.id);
      reply.status(410);
      return { error: 'That download link has expired.' };
    }

    // Defense in depth: the path is server-generated inside tempDir, but confirm
    // the resolved file really lives under tempDir (no traversal/symlink escape).
    const resolved = path.resolve(job.filePath);
    const tempRoot = path.resolve(config.tempDir) + path.sep;
    if (!resolved.startsWith(tempRoot)) {
      reply.status(403);
      return { error: 'That file cannot be downloaded.' };
    }

    const stat = await fs.stat(resolved);
    reply.header('Content-Type', job.mimeType || 'application/octet-stream');
    reply.header('Content-Length', stat.size);
    reply.header('Content-Disposition', contentDisposition(job.fileName));

    // One-time download: remove the file and job once the response finishes or
    // the client disconnects, so nothing lingers on disk.
    reply.raw.on('close', () => {
      void store.delete(job).finally(() => removeJobTempFiles(job.id));
    });

    return reply.send(createReadStream(resolved));
  });

  try {
    await fs.access(publicDir());
    await app.register(fastifyStatic, {
      root: publicDir(),
      wildcard: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/download/')) {
        reply.sendFile('index.html');
        return;
      }
      reply.status(404).send({ error: 'Not found' });
    });
  } catch {
    app.get('/', async () => ({ ok: true, message: 'LinkSave - Family Downloader API is running.' }));
  }

  return app;
}

const app = await buildServer();
await app.listen({ port: config.port, host: '0.0.0.0' });
