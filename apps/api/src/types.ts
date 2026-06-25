export type DownloadMode = 'video' | 'audio';
export type VideoQuality = 'best' | '1080p' | '720p' | '480p';
export type AudioQuality = 'mp3' | 'best-audio';
export type Quality = VideoQuality | AudioQuality;

export type JobStatus =
  | 'queued'
  | 'checking'
  | 'downloading'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'expired';

export interface UserIdentity {
  id: string;
  email?: string;
  source: 'cloudflare' | 'development';
}

export interface VideoMetadata {
  title: string;
  thumbnail?: string;
  durationSeconds?: number;
  sourceName: string;
  webpageUrl: string;
}

export interface DownloadJob {
  id: string;
  userId: string;
  url: string;
  mode: DownloadMode;
  quality: Quality;
  // When true, a "best" video may go up to 4K; otherwise it is capped at 1080p.
  allowHighRes: boolean;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  downloadToken: string;
  metadata?: VideoMetadata;
  filePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  errorMessage?: string;
}

export interface PublicJob {
  id: string;
  status: JobStatus;
  mode: DownloadMode;
  quality: Quality;
  metadata?: VideoMetadata;
  errorMessage?: string;
  downloadUrl?: string;
  expiresAt: number;
}
