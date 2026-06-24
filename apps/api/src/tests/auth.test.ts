import { describe, expect, it, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { verifyAccessJwt, resolveIdentity } from '../auth.js';
import type { FastifyRequest } from 'fastify';

const issuer = 'https://myteam.cloudflareaccess.com';
const audience = 'test-aud-tag';

let signingKey: KeyLike;
let getKey: JWTVerifyGetKey;
let wrongGetKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  getKey = (async () => pair.publicKey) as unknown as JWTVerifyGetKey;
  const otherPair = await generateKeyPair('RS256');
  wrongGetKey = (async () => otherPair.publicKey) as unknown as JWTVerifyGetKey;
});

function signToken(claims: Record<string, unknown>, overrides?: { issuer?: string; audience?: string; expSeconds?: number }) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(overrides?.issuer ?? issuer)
    .setAudience(overrides?.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime(`${overrides?.expSeconds ?? 300}s`)
    .sign(signingKey);
}

describe('Cloudflare Access JWT validation', () => {
  it('accepts a valid token and derives a stable identity', async () => {
    const token = await signToken({ email: 'Parent@Example.com' });
    const identity = await verifyAccessJwt(token, { issuer, audience, getKey });
    expect(identity.source).toBe('cloudflare');
    expect(identity.email).toBe('Parent@Example.com');
    expect(identity.id).toMatch(/^[0-9a-f]{32}$/);

    // Same email (case-insensitive) yields the same id; different email differs.
    const again = await verifyAccessJwt(await signToken({ email: 'parent@example.com' }), {
      issuer,
      audience,
      getKey
    });
    expect(again.id).toBe(identity.id);
    const other = await verifyAccessJwt(await signToken({ email: 'kid@example.com' }), {
      issuer,
      audience,
      getKey
    });
    expect(other.id).not.toBe(identity.id);
  });

  it('rejects a wrong audience', async () => {
    const token = await signToken({ email: 'a@example.com' }, { audience: 'someone-elses-app' });
    await expect(verifyAccessJwt(token, { issuer, audience, getKey })).rejects.toThrow();
  });

  it('rejects a wrong issuer', async () => {
    const token = await signToken({ email: 'a@example.com' }, { issuer: 'https://evil.cloudflareaccess.com' });
    await expect(verifyAccessJwt(token, { issuer, audience, getKey })).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ email: 'a@example.com' }, { expSeconds: -10 });
    await expect(verifyAccessJwt(token, { issuer, audience, getKey })).rejects.toThrow();
  });

  it('rejects a token signed by a different key', async () => {
    const token = await signToken({ email: 'a@example.com' });
    await expect(verifyAccessJwt(token, { issuer, audience, getKey: wrongGetKey })).rejects.toThrow();
  });

  it('rejects a token with no identity claim', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('300s')
      .sign(signingKey);
    await expect(verifyAccessJwt(token, { issuer, audience, getKey })).rejects.toThrow(/identity/);
  });
});

describe('development identity (Access disabled)', () => {
  function fakeRequest(headers: Record<string, string> = {}): FastifyRequest {
    return { headers } as unknown as FastifyRequest;
  }

  it('synthesizes a stable development user', async () => {
    const a = await resolveIdentity(fakeRequest());
    expect(a?.source).toBe('development');
    const b = await resolveIdentity(fakeRequest({ 'x-dev-user': 'grandma@example.com' }));
    expect(b?.email).toBe('grandma@example.com');
    expect(b?.id).not.toBe(a?.id);
  });
});
