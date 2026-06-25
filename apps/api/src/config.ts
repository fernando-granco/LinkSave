import { z } from 'zod';

const boolFromString = z
  .string()
  .optional()
  .transform((value) => value !== 'false');

const intFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return fallback;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    });

// Cloudflare gives each Access application a team domain (e.g. "myteam" or
// "myteam.cloudflareaccess.com"). The JWT issuer is the full https URL form.
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

const schema = z
  .object({
    nodeEnv: z.string().default('development'),
    port: intFromString(3000),
    redisUrl: z.string().default('redis://127.0.0.1:6379'),
    tempDir: z.string().default('/tmp/family-downloader'),
    publicBaseUrl: z.string().default('http://localhost:3000'),
    requireCloudflareAccess: boolFromString,
    cfAccessTeamDomain: optionalString,
    cfAccessAud: optionalString,
    maxGlobalConcurrentJobs: intFromString(2),
    maxConcurrentJobsPerUser: intFromString(1),
    maxVideoDurationSeconds: intFromString(7200),
    maxFileSizeBytes: intFromString(2147483648),
    jobExpirationSeconds: intFromString(900),
    cleanupIntervalSeconds: intFromString(60),
    inspectTimeoutMs: intFromString(25000),
    downloadTimeoutMs: intFromString(1_200_000),
    rateLimitMax: intFromString(20),
    rateLimitWindow: z.string().default('1 minute'),
    allow4k: boolFromString,
    ytDlpAutoUpdate: boolFromString,
    ytDlpDir: z.string().default('/data/yt-dlp'),
    ytDlpUpdateIntervalHours: intFromString(24)
  })
  .superRefine((value, ctx) => {
    // Fail closed: if Cloudflare Access is required, we must be able to verify
    // its JWTs. Without issuer + audience we would have to trust a spoofable
    // plaintext header, so refuse to start instead.
    if (value.requireCloudflareAccess) {
      if (!value.cfAccessTeamDomain) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cfAccessTeamDomain'],
          message:
            'CF_ACCESS_TEAM_DOMAIN is required when REQUIRE_CLOUDFLARE_ACCESS is true (e.g. "myteam" or "myteam.cloudflareaccess.com").'
        });
      }
      if (!value.cfAccessAud) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cfAccessAud'],
          message:
            'CF_ACCESS_AUD is required when REQUIRE_CLOUDFLARE_ACCESS is true (the Access application Audience tag).'
        });
      }
    }
  });

export const config = schema.parse({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  redisUrl: process.env.REDIS_URL,
  tempDir: process.env.TEMP_DIR,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  requireCloudflareAccess: process.env.REQUIRE_CLOUDFLARE_ACCESS,
  cfAccessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
  cfAccessAud: process.env.CF_ACCESS_AUD,
  maxGlobalConcurrentJobs: process.env.MAX_GLOBAL_CONCURRENT_JOBS,
  maxConcurrentJobsPerUser: process.env.MAX_CONCURRENT_JOBS_PER_USER,
  maxVideoDurationSeconds: process.env.MAX_VIDEO_DURATION_SECONDS,
  maxFileSizeBytes: process.env.MAX_FILE_SIZE_BYTES,
  jobExpirationSeconds: process.env.JOB_EXPIRATION_SECONDS,
  cleanupIntervalSeconds: process.env.CLEANUP_INTERVAL_SECONDS,
  inspectTimeoutMs: process.env.INSPECT_TIMEOUT_MS,
  downloadTimeoutMs: process.env.DOWNLOAD_TIMEOUT_MS,
  rateLimitMax: process.env.RATE_LIMIT_MAX,
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW,
  allow4k: process.env.ALLOW_4K,
  ytDlpAutoUpdate: process.env.YT_DLP_AUTO_UPDATE,
  ytDlpDir: process.env.YT_DLP_DIR,
  ytDlpUpdateIntervalHours: process.env.YT_DLP_UPDATE_INTERVAL_HOURS
});

export type AppConfig = typeof config;
