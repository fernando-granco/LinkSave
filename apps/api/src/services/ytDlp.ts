import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { DownloadJob, VideoMetadata } from '../types.js';
import { getFormatPreset } from './formatPresets.js';
import { friendlySourceName } from './urlSafety.js';
import { safeBaseName } from './filenames.js';
import { getYtDlp } from './ytDlpUpdater.js';

interface RunResult {
  stdout: string;
  stderr: string;
}

interface RunOptions {
  timeoutMs: number;
  onLine?: (line: string) => void;
}

// Grace period between SIGTERM and SIGKILL when a process overruns its timeout.
const KILL_GRACE_MS = 5000;

/**
 * Run yt-dlp with an explicit argument array (never a shell string) and a hard
 * wall-clock timeout. On timeout the process is sent SIGTERM, then SIGKILL, so a
 * hung or runaway download cannot hold a concurrency slot forever.
 */
function runYtDlp(args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const ytDlp = getYtDlp();
    const child = spawn(ytDlp.command, [...ytDlp.prefixArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ytDlp.env ? { ...process.env, ...ytDlp.env } : process.env
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, options.timeoutMs);

    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      if (options.onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) options.onLine(line.trim());
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));

    child.on('error', (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        reject(new Error('That download took too long and was stopped.'));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.split(/\r?\n/).find(Boolean) || 'The download did not finish.'));
    });
  });
}

function parseInfo(stdout: string, url: string): VideoMetadata {
  const parsed = JSON.parse(stdout);
  return {
    title: typeof parsed.title === 'string' ? parsed.title : 'Video download',
    thumbnail: typeof parsed.thumbnail === 'string' ? parsed.thumbnail : undefined,
    durationSeconds: typeof parsed.duration === 'number' ? parsed.duration : undefined,
    sourceName: typeof parsed.extractor_key === 'string' ? parsed.extractor_key : friendlySourceName(url),
    webpageUrl: typeof parsed.webpage_url === 'string' ? parsed.webpage_url : url
  };
}

export async function inspectWithYtDlp(url: string): Promise<VideoMetadata> {
  const { stdout } = await runYtDlp(
    [
      '--dump-single-json',
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '--socket-timeout',
      '15',
      '--',
      url
    ],
    { timeoutMs: config.inspectTimeoutMs }
  );

  const metadata = parseInfo(stdout, url);
  if (
    metadata.durationSeconds &&
    config.maxVideoDurationSeconds > 0 &&
    metadata.durationSeconds > config.maxVideoDurationSeconds
  ) {
    throw new Error('That video is longer than this downloader allows.');
  }

  return metadata;
}

export async function downloadWithYtDlp(
  job: DownloadJob
): Promise<Required<Pick<DownloadJob, 'filePath' | 'fileName' | 'mimeType' | 'fileSize' | 'metadata'>>> {
  await fs.mkdir(config.tempDir, { recursive: true });
  const metadata = job.metadata || (await inspectWithYtDlp(job.url));
  const preset = getFormatPreset(job.mode, job.quality, job.allowHighRes ?? false);
  const outputTemplate = path.join(config.tempDir, `${job.id}.%(ext)s`);

  const sizeGuard =
    config.maxFileSizeBytes > 0 ? ['--max-filesize', String(config.maxFileSizeBytes)] : [];

  await runYtDlp(
    [
      '--no-playlist',
      '--restrict-filenames',
      '--newline',
      '--socket-timeout',
      '15',
      '--no-cache-dir',
      ...sizeGuard,
      ...preset.args,
      '-o',
      outputTemplate,
      '--',
      job.url
    ],
    { timeoutMs: config.downloadTimeoutMs }
  );

  // Pick the finished output (ignore any leftover .part fragments).
  const entries = await fs.readdir(config.tempDir);
  const fileNameOnDisk = entries
    .filter((entry) => entry.startsWith(`${job.id}.`) && !entry.endsWith('.part'))
    .sort()[0];
  if (!fileNameOnDisk) {
    throw new Error('The file could not be prepared.');
  }

  const filePath = path.join(config.tempDir, fileNameOnDisk);
  const stat = await fs.stat(filePath);
  if (config.maxFileSizeBytes > 0 && stat.size > config.maxFileSizeBytes) {
    await removeJobTempFiles(job.id);
    throw new Error('That file is larger than this downloader allows.');
  }

  const extension = path.extname(fileNameOnDisk).replace('.', '') || preset.extension;
  return {
    filePath,
    fileName: `${safeBaseName(metadata.title)}.${extension}`,
    mimeType: preset.mimeType,
    fileSize: stat.size,
    metadata
  };
}

/** Remove every temp file (including .part fragments) belonging to a job. */
export async function removeJobTempFiles(jobId: string): Promise<void> {
  try {
    const entries = await fs.readdir(config.tempDir);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(`${jobId}.`))
        .map((entry) => fs.rm(path.join(config.tempDir, entry), { force: true }))
    );
  } catch {
    // Cleanup is best-effort and must never mask the user-facing result.
  }
}
