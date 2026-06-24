import { describe, expect, it } from 'vitest';
import { safeBaseName } from '../services/filenames.js';

describe('safeBaseName', () => {
  it('keeps simple titles readable', () => {
    expect(safeBaseName('My Holiday Video')).toBe('My Holiday Video');
  });

  it('strips path separators and traversal sequences', () => {
    expect(safeBaseName('../../etc/passwd')).not.toContain('/');
    expect(safeBaseName('..\\..\\windows')).not.toContain('\\');
    expect(safeBaseName('a/b/c')).toBe('abc');
  });

  it('removes characters usable for injection', () => {
    const cleaned = safeBaseName('title"; rm -rf / #\n$(whoami)`id`');
    expect(cleaned).not.toMatch(/["`$();]/);
    expect(cleaned).not.toContain('\n');
  });

  it('collapses whitespace and bounds the length', () => {
    expect(safeBaseName('a   b\t\nc')).toBe('a b c');
    expect(safeBaseName('x'.repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it('falls back when nothing safe remains', () => {
    expect(safeBaseName('日本語のみ')).toBe('video-download');
    expect(safeBaseName('')).toBe('video-download');
  });
});
