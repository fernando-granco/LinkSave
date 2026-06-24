import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { config } from './config.js';
import type { UserIdentity } from './types.js';

// Cache the resolved identity per request so the JWT is verified at most once
// (the rate limiter and the route handlers both read it). A WeakMap keeps the
// FastifyRequest type clean and lets entries be garbage-collected with the
// request. The wrapper object lets us distinguish "not resolved yet" from
// "resolved to undefined" (unauthenticated).
const identityCache = new WeakMap<FastifyRequest, { identity: UserIdentity | undefined }>();

function stableUserId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function firstHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalize the configured team domain into the issuer URL that Cloudflare
 * Access stamps into its JWTs. Accepts "myteam", "myteam.cloudflareaccess.com",
 * or the full "https://myteam.cloudflareaccess.com".
 */
function buildIssuer(teamDomain: string): string {
  const trimmed = teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const host = trimmed.includes('.') ? trimmed : `${trimmed}.cloudflareaccess.com`;
  return `https://${host}`;
}

interface AccessVerifier {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
}

// Lazily build the verifier so importing this module never performs network
// work and unit tests can run without Cloudflare configuration.
let verifier: AccessVerifier | undefined;
function getVerifier(): AccessVerifier {
  if (verifier) return verifier;
  if (!config.cfAccessTeamDomain || !config.cfAccessAud) {
    // config.ts fails closed before this can happen, but guard anyway.
    throw new Error('Cloudflare Access is required but not configured.');
  }
  const issuer = buildIssuer(config.cfAccessTeamDomain);
  verifier = {
    issuer,
    audience: config.cfAccessAud,
    getKey: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  };
  return verifier;
}

/**
 * Verify a Cloudflare Access JWT. `jwtVerify` checks the signature against the
 * team JWKS and validates issuer, audience, and expiry/not-before. We then
 * require an identity claim (email or subject) before trusting the request.
 */
export async function verifyAccessJwt(
  token: string,
  override?: Pick<AccessVerifier, 'issuer' | 'audience' | 'getKey'>
): Promise<UserIdentity> {
  const { issuer, audience, getKey } = override ?? getVerifier();
  const { payload } = await jwtVerify(token, getKey, { issuer, audience });

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const subject = email ?? (typeof payload.sub === 'string' ? payload.sub : undefined);
  if (!subject) {
    throw new Error('Access token did not contain an identity.');
  }

  return {
    id: stableUserId(subject.toLowerCase()),
    email,
    source: 'cloudflare'
  };
}

function developmentIdentity(request: FastifyRequest): UserIdentity {
  const devUser = firstHeader(request, 'x-dev-user') || 'local-development-user';
  return {
    id: stableUserId(devUser.toLowerCase()),
    email: devUser.includes('@') ? devUser : undefined,
    source: 'development'
  };
}

/**
 * Resolve (and cache) the authenticated identity for a request. Returns
 * `undefined` when the caller is not authenticated. When Cloudflare Access is
 * required we ONLY trust a validated JWT — the plaintext
 * `Cf-Access-Authenticated-User-Email` header is never trusted, because anything
 * able to reach the origin directly could forge it.
 */
export async function resolveIdentity(request: FastifyRequest): Promise<UserIdentity | undefined> {
  const cached = identityCache.get(request);
  if (cached) return cached.identity;

  let identity: UserIdentity | undefined;
  if (config.requireCloudflareAccess) {
    const token = firstHeader(request, 'cf-access-jwt-assertion');
    if (token) {
      try {
        identity = await verifyAccessJwt(token);
      } catch (error) {
        request.log.warn({ err: error }, 'Cloudflare Access JWT verification failed');
        identity = undefined;
      }
    }
  } else {
    identity = developmentIdentity(request);
  }

  identityCache.set(request, { identity });
  return identity;
}

/** Read the already-resolved identity without re-verifying. */
export function getIdentity(request: FastifyRequest): UserIdentity | undefined {
  return identityCache.get(request)?.identity;
}

/** Require an authenticated identity or throw a 401. */
export function requireIdentity(request: FastifyRequest): UserIdentity {
  const identity = getIdentity(request);
  if (!identity) {
    const error = new Error('Please sign in through Cloudflare Access and try again.');
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
  return identity;
}
