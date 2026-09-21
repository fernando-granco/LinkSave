# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** feature (Security Advisories) instead of opening a public issue. Include the affected version or commit, deployment shape, reproduction steps, and likely impact. Do not include real download URLs, Cloudflare tokens, or other credentials.

## Deployment model

LinkSave has no accounts, passwords, or login screen of its own. Anyone who can reach the port can use it — that is fine on a trusted LAN or behind a VPN, but LinkSave should never be exposed directly to the internet. If you publish it beyond your home network, put it behind a maintained authentication layer such as Cloudflare Access, Authelia, or an authenticated VPN.

When `REQUIRE_CLOUDFLARE_ACCESS=true` is set, the API only trusts a validated `Cf-Access-Jwt-Assertion` JWT, verified against `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` — the plaintext `Cf-Access-Authenticated-User-Email` header is never trusted, since anything able to reach the origin directly could forge it. Without Cloudflare Access, per-user limits fall back to the client's IP address.

The server rejects cross-origin browser requests and does not accept CORS from other origins. URL checks block requests targeting local and private network addresses (SSRF protection for the yt-dlp fetch step), but no self-hosted downloader should be treated as risk-free: keep the app private, keep its images up to date, and don't rely on it for content you don't have permission to save.

Temporary downloaded media lives only for the configured `JOB_EXPIRATION_SECONDS` before automatic cleanup; LinkSave is not a media library or long-term store.

Supported security fixes target the current `main` branch.
