import { describe, expect, it } from 'vitest';
import { isPrivateOrReservedIp, parsePublicUrl } from '../services/urlSafety.js';

describe('url safety', () => {
  it('accepts public http and https URLs', () => {
    expect(parsePublicUrl('https://example.com/watch?v=1').hostname).toBe('example.com');
    expect(parsePublicUrl('http://example.com/video').protocol).toBe('http:');
  });

  it('rejects unsupported schemes', () => {
    expect(() => parsePublicUrl('file:///etc/passwd')).toThrow(/normal website/);
    expect(() => parsePublicUrl('ftp://example.com/file')).toThrow(/normal website/);
    expect(() => parsePublicUrl('data:text/html,<script>')).toThrow(/normal website/);
    expect(() => parsePublicUrl('javascript:alert(1)')).toThrow(/normal website/);
  });

  it('rejects embedded credentials', () => {
    expect(() => parsePublicUrl('https://user:pass@example.com')).toThrow(/usernames/);
    expect(() => parsePublicUrl('https://user@example.com')).toThrow(/usernames/);
  });

  it('rejects local hostnames', () => {
    expect(() => parsePublicUrl('http://localhost:8080')).toThrow(/private address/);
    expect(() => parsePublicUrl('http://service.localhost')).toThrow(/private address/);
    expect(() => parsePublicUrl('http://nas.local')).toThrow(/private address/);
  });

  it('rejects private and reserved IPv4 literals', () => {
    for (const host of [
      'http://127.0.0.1',
      'http://10.0.0.2',
      'http://172.16.5.4',
      'http://192.168.1.10',
      'http://169.254.169.254', // cloud metadata
      'http://100.64.0.1', // carrier-grade NAT
      'http://0.0.0.0'
    ]) {
      expect(() => parsePublicUrl(host), host).toThrow(/private address/);
    }
  });

  it('rejects loopback and link-local IPv6 literals (including IPv4-mapped forms)', () => {
    for (const host of [
      'http://[::1]',
      'http://[fe80::1]',
      'http://[fc00::1]',
      'http://[fd12:3456::1]',
      'http://[::ffff:127.0.0.1]',
      'http://[::ffff:169.254.169.254]',
      'http://[::ffff:a9fe:a9fe]' // hex form of 169.254.169.254
    ]) {
      expect(() => parsePublicUrl(host), host).toThrow(/private address/);
    }
  });

  it('classifies individual addresses', () => {
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::abcd')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });
});
