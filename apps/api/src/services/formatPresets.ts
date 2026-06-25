import type { AudioQuality, DownloadMode, Quality, VideoQuality } from '../types.js';

export interface FormatPreset {
  args: string[];
  extension: 'mp4' | 'mp3' | 'm4a' | 'webm';
  mimeType: string;
  label: string;
}

const videoFormat = (height?: number): string => {
  if (!height) return 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/best';
  return [
    `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]`,
    `b[height<=${height}][ext=mp4]`,
    `bv*[height<=${height}]+ba`,
    `b[height<=${height}]`,
    'best'
  ].join('/');
};

// "Best available" ceiling. 4K renditions are usually VP9/AV1, so they are
// opt-in via allowHighRes; the default keeps files broadly compatible at 1080p.
const BEST_HEIGHT_DEFAULT = 1080;
const BEST_HEIGHT_HIGH_RES = 2160;

export function getFormatPreset(
  mode: DownloadMode,
  quality: Quality,
  allowHighRes = false
): FormatPreset {
  if (mode === 'video') {
    const videoQuality = quality as VideoQuality;
    const height =
      videoQuality === 'best'
        ? allowHighRes
          ? BEST_HEIGHT_HIGH_RES
          : BEST_HEIGHT_DEFAULT
        : Number.parseInt(videoQuality, 10);
    return {
      args: ['-f', videoFormat(height), '--merge-output-format', 'mp4', '--remux-video', 'mp4'],
      extension: 'mp4',
      mimeType: 'video/mp4',
      label:
        videoQuality === 'best'
          ? `Best available MP4 (up to ${allowHighRes ? '4K' : '1080p'})`
          : `${videoQuality} MP4`
    };
  }

  const audioQuality = quality as AudioQuality;
  if (audioQuality === 'm4a') {
    // Keep the source AAC stream where possible (fast, no re-encode).
    return {
      args: ['-f', 'ba[ext=m4a]/ba/bestaudio', '--extract-audio', '--audio-format', 'm4a'],
      extension: 'm4a',
      mimeType: 'audio/mp4',
      label: 'M4A audio (original)'
    };
  }

  // mp3-128 / mp3-192 / mp3-320 — transcode to MP3 at a fixed bitrate.
  const kbps = audioQuality.slice('mp3-'.length);
  return {
    args: ['-f', 'ba/bestaudio', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', `${kbps}K`],
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    label: `MP3 ${kbps} kbps`
  };
}

const videoQualities = new Set<Quality>(['best', '1080p', '720p', '480p']);
const audioQualities = new Set<Quality>(['m4a', 'mp3-128', 'mp3-192', 'mp3-320']);

export function isQualityAllowed(mode: DownloadMode, quality: Quality): boolean {
  return mode === 'video' ? videoQualities.has(quality) : audioQualities.has(quality);
}
