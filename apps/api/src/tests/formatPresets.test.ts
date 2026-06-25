import { describe, expect, it } from 'vitest';
import { getFormatPreset, isQualityAllowed } from '../services/formatPresets.js';

describe('format presets', () => {
  it('maps video quality to safe fixed yt-dlp arguments', () => {
    const preset = getFormatPreset('video', '1080p');
    expect(preset.args).toContain('-f');
    expect(preset.args.join(' ')).toContain('height<=1080');
    expect(preset.args.join(' ')).toContain('--merge-output-format mp4');
    expect(preset.extension).toBe('mp4');
  });

  it('caps "best" at 1080p unless high-res is allowed', () => {
    expect(getFormatPreset('video', 'best', false).args.join(' ')).toContain('height<=1080');
    expect(getFormatPreset('video', 'best', false).args.join(' ')).not.toContain('height<=2160');
    expect(getFormatPreset('video', 'best', true).args.join(' ')).toContain('height<=2160');
  });

  it('ignores high-res for fixed resolutions and audio', () => {
    expect(getFormatPreset('video', '720p', true).args.join(' ')).toContain('height<=720');
    expect(getFormatPreset('audio', 'mp3', true).extension).toBe('mp3');
  });

  it('maps audio options without accepting arbitrary choices', () => {
    expect(getFormatPreset('audio', 'mp3').args).toContain('--audio-format');
    expect(getFormatPreset('audio', 'best-audio').extension).toBe('m4a');
    expect(isQualityAllowed('video', 'mp3')).toBe(false);
    expect(isQualityAllowed('audio', '1080p')).toBe(false);
  });
});
