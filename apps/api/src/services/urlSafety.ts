import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const allowedSchemes = new Set(['http:', 'https:']);
const blockedHosts = new Set(['localhost', 'localhost.localdomain']);

const PRIVATE_ADDRESS_MESSAGE = 'That link points to a private address and cannot be used.';

/**
 * Decide whether an IP literal is private, reserved, or otherwise unsafe to
 * fetch (SSRF protection). Anything that is not normal public unicast is
 * rejected, and IPv4-mapped IPv6 addresses are unwrapped first so tricks like
 * `::ffff:169.254.169.254` (or its hex form) cannot smuggle a private target.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    // Not a parseable IP: callers should resolve the hostname instead. Treat an
    // unexpected value here as unsafe.
    return true;
  }

  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return v6.toIPv4Address().range() !== 'unicast';
    }
  }

  // ipaddr labels public addresses as 'unicast'; every other range
  // (loopback, private, linkLocal, uniqueLocal, multicast, reserved,
  // carrierGradeNat, 6to4, teredo, …) is unsafe.
  return parsed.range() !== 'unicast';
}

function ipLiteral(hostname: string): string {
  // URL hostnames keep IPv6 literals in brackets (e.g. "[::1]").
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

export function parsePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Please paste a full video link, starting with http:// or https://.');
  }

  if (!allowedSchemes.has(url.protocol)) {
    throw new Error('Only normal website links are supported.');
  }

  if (url.username || url.password) {
    throw new Error('Links with embedded usernames or passwords are not supported.');
  }

  const hostname = url.hostname.toLowerCase();
  if (blockedHosts.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(PRIVATE_ADDRESS_MESSAGE);
  }

  const literal = ipLiteral(hostname);
  if (ipaddr.isValid(literal) && isPrivateOrReservedIp(literal)) {
    throw new Error(PRIVATE_ADDRESS_MESSAGE);
  }

  return url;
}

/**
 * Validate a URL and confirm its hostname does not resolve to a private or
 * reserved address. NOTE: yt-dlp performs its own DNS resolution later, so this
 * does not fully prevent DNS-rebinding or redirect-to-internal attacks — see
 * the README "Security Model" notes on residual SSRF risk.
 */
export async function assertPublicUrl(input: string): Promise<URL> {
  const url = parsePublicUrl(input);
  const hostname = url.hostname.toLowerCase();
  const literal = ipLiteral(hostname);

  if (ipaddr.isValid(literal)) return url;

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('I could not find that website. Please check the link.');
  }

  if (records.length === 0 || records.some((record) => isPrivateOrReservedIp(record.address))) {
    throw new Error(PRIVATE_ADDRESS_MESSAGE);
  }

  return url;
}

export function friendlySourceName(url: string): string {
  const hostname = parsePublicUrl(url).hostname.replace(/^www\./, '');
  const first = hostname.split('.')[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : hostname;
}
