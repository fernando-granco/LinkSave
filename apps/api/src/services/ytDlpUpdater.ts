import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import { config } from '../config.js';

// Python interpreter from the venv that has yt-dlp's dependencies (built into
// the image). We update yt-dlp into a writable volume and run it from there.
const VENV_PYTHON = '/opt/ytdlp/bin/python3';

export interface YtDlpCommand {
  command: string;
  prefixArgs: string[];
  env?: NodeJS.ProcessEnv;
}

// Default: the yt-dlp pinned into the image at build time. This always works
// offline; the updater only switches to a newer copy once it is verified.
let active: YtDlpCommand = { command: 'yt-dlp', prefixArgs: [] };

export function getYtDlp(): YtDlpCommand {
  return active;
}

interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Best-effort: install the latest yt-dlp (and its deps) into a writable volume
 * and, only if it runs cleanly, switch to it. Any failure (offline, pip error)
 * leaves the pinned image version active, so downloads never break because of
 * an update attempt.
 */
export async function updateYtDlp(logger: Logger): Promise<void> {
  if (!config.ytDlpAutoUpdate) return;
  const siteDir = path.join(config.ytDlpDir, 'site');

  try {
    await fs.mkdir(siteDir, { recursive: true });
    logger.info('checking for a yt-dlp update');
    const install = await run(
      VENV_PYTHON,
      ['-m', 'pip', 'install', '--no-cache-dir', '--upgrade', '--target', siteDir, 'yt-dlp'],
      180_000
    );
    if (install.code !== 0) {
      logger.warn(
        { detail: install.stderr.split('\n').filter(Boolean).slice(-2).join(' ') },
        'yt-dlp update failed; keeping the current version'
      );
      return;
    }

    const candidate: YtDlpCommand = {
      command: VENV_PYTHON,
      prefixArgs: ['-m', 'yt_dlp'],
      env: { PYTHONPATH: siteDir }
    };
    const check = await run(candidate.command, [...candidate.prefixArgs, '--version'], 30_000, candidate.env);
    const version = check.stdout.trim();
    if (check.code !== 0 || !version) {
      logger.warn('updated yt-dlp did not run; keeping the current version');
      return;
    }

    active = candidate;
    logger.info({ version }, 'yt-dlp updated');
  } catch (error) {
    logger.warn({ err: error }, 'yt-dlp update error; keeping the current version');
  }
}

/** Update now (in the background) and then on a fixed interval. */
export function scheduleYtDlpUpdates(logger: Logger): void {
  if (!config.ytDlpAutoUpdate) {
    logger.info('yt-dlp auto-update is disabled; using the pinned version');
    return;
  }
  void updateYtDlp(logger);
  const intervalMs = Math.max(1, config.ytDlpUpdateIntervalHours) * 3_600_000;
  setInterval(() => void updateYtDlp(logger), intervalMs).unref();
}
