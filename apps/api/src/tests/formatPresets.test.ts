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

  it('maps audio options without accepting arbitrary choices', () => {
    expect(getFormatPreset('audio', 'mp3').args).toContain('--audio-format');
    expect(getFormatPreset('audio', 'best-audio').extension).toBe('m4a');
    expect(isQualityAllowed('video', 'mp3')).toBe(false);
    expect(isQualityAllowed('audio', '1080p')).toBe(false);
  });
});
