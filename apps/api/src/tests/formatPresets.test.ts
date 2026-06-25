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
    expect(getFormatPreset('audio', 'mp3-320', true).extension).toBe('mp3');
  });

  it('maps audio bitrates to fixed MP3 presets', () => {
    expect(getFormatPreset('audio', 'mp3-128').args.join(' ')).toContain('--audio-quality 128K');
    expect(getFormatPreset('audio', 'mp3-320').args.join(' ')).toContain('--audio-quality 320K');
    expect(getFormatPreset('audio', 'mp3-192').extension).toBe('mp3');
    expect(getFormatPreset('audio', 'm4a').extension).toBe('m4a');
  });

  it('rejects mismatched or arbitrary choices', () => {
    expect(isQualityAllowed('video', 'mp3-320')).toBe(false);
    expect(isQualityAllowed('audio', '1080p')).toBe(false);
    expect(isQualityAllowed('audio', 'mp3-256' as never)).toBe(false);
  });
});
