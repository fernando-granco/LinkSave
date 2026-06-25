# LinkSave - Family Downloader

LinkSave - Family Downloader is a small, self-hosted web app for downloading public videos through a simple browser UI. It is meant for trusted family use behind Cloudflare Access: someone opens your private downloader URL, pastes a public link, chooses Video or Audio, and receives a normal browser file download.

Only download content you are allowed to save. This project does not implement cookies, account logins, DRM bypassing, CAPTCHA bypassing, or private/restricted content access.

## How it works

1. You paste a public video link. As you type, the app asks the backend to **inspect** it and shows a small preview (title, source, duration) so you know it found the right thing.
2. You pick **Video** or **Audio** and a quality option. These map to a fixed set of safe yt-dlp presets — your input never becomes command-line flags.
3. When you press **Download**, the API creates a short-lived job tied to your identity and puts it on a queue.
4. A separate **worker** process is the only thing that runs `yt-dlp` and FFmpeg. It validates the URL again, downloads the media into a temporary folder, enforces duration/size limits, and marks the job ready.
5. The browser polls the job and, once it's ready, automatically streams the file to you as a normal download.
6. The temporary file is deleted as soon as the download finishes (or you disconnect), and a background sweep removes anything left over. There is **no permanent media library** — nothing is kept after you have your file.

Everything runs in Docker: a small web/API container, a worker container, Redis for short-lived job state, and (optionally) Cloudflare Tunnel as the public entrypoint. Only the tunnel is exposed publicly; the app and Redis stay on the internal Docker network.

## Architecture

- `apps/web`: React + Vite one-page interface with large, plain controls.
- `apps/api`: Fastify API that validates Cloudflare Access JWTs, creates short-lived jobs, authorizes download access, and serves the built frontend.
- `worker`: the same API image running `node dist/worker.js`; it is the only process that runs `yt-dlp` and FFmpeg.
- `redis`: short-lived job status, queues, ownership checks, and concurrency tracking.
- `cloudflared`: Cloudflare Tunnel entrypoint. The app container exposes port `3000` only to the Docker network.

Temporary media files are stored in the `media-tmp` Docker volume and are deleted after download, cancellation, failure, or expiry cleanup.

## Local Development

Requirements:

- Node.js 20+
- Redis
- `yt-dlp`
- FFmpeg

```bash
cp .env.example .env
npm install
npm --workspace apps/api run dev
npm --workspace apps/api run dev:worker
npm --workspace apps/web run dev
```

For local development, set this in `.env`:

```bash
REQUIRE_CLOUDFLARE_ACCESS=false
REDIS_URL=redis://127.0.0.1:6379
```

Open `http://localhost:5173`. The Vite server proxies `/api` and `/download` to the API server.

## Docker Compose Deployment

On a small VPS:

```bash
cp .env.example .env
# Edit .env
docker compose up -d --build
```

The Compose file intentionally does not publish the app or Redis ports. Cloudflare Tunnel reaches the app through the internal Docker network.

## Cloudflare Tunnel

1. In Cloudflare Zero Trust, create a named tunnel.
2. Copy the tunnel token into `.env` as `CLOUDFLARED_TOKEN`.
3. Add a public hostname:
   - Hostname: your private downloader hostname
   - Service type: `HTTP`
   - Service URL: `http://app:3000`
4. Start Docker Compose.

The `cloudflared` service reads the token from the `TUNNEL_TOKEN` environment
variable (set from `CLOUDFLARED_TOKEN`), so the secret never appears on the
command line or in `docker inspect`.

## Cloudflare Access (optional, recommended)

Authentication is optional. The app works on its own (for example on a trusted LAN) with `REQUIRE_CLOUDFLARE_ACCESS=false`. If you want to expose it to the internet, put it behind **Cloudflare Access** so only people you choose can reach it — this is how we run it.

When enabled, the app validates the Cloudflare Access JWT itself (signature, issuer, audience, expiry); it does not just trust a header. You only need two settings, both required when `REQUIRE_CLOUDFLARE_ACCESS=true`:

- `CF_ACCESS_TEAM_DOMAIN` — your Zero Trust team domain, e.g. `myteam` (the JWT issuer becomes `https://myteam.cloudflareaccess.com`).
- `CF_ACCESS_AUD` — the **Application Audience (AUD) tag** from the Access application's *Overview* page.

Create the Access application for your hostname and allow only the family members who should use it. That's it — the app reads the signed-in user's email from the validated token.

## Environment Variables

| Name | Purpose | Default |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | Public app URL | `https://download.example.com` |
| `REQUIRE_CLOUDFLARE_ACCESS` | Require & validate Cloudflare Access JWTs | `true` |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust team domain (JWT issuer) | required when Access is on |
| `CF_ACCESS_AUD` | Access application Audience (AUD) tag | required when Access is on |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `TEMP_DIR` | Temporary media directory in containers | `/data/media` |
| `MAX_GLOBAL_CONCURRENT_JOBS` | Total active jobs allowed | `2` |
| `MAX_CONCURRENT_JOBS_PER_USER` | Active jobs per signed-in user | `1` |
| `MAX_VIDEO_DURATION_SECONDS` | Maximum inspected video duration | `7200` |
| `MAX_FILE_SIZE_BYTES` | Maximum completed file size | `2147483648` |
| `JOB_EXPIRATION_SECONDS` | Job/download URL lifetime | `900` |
| `CLEANUP_INTERVAL_SECONDS` | Temporary file cleanup interval | `60` |
| `INSPECT_TIMEOUT_MS` | Link inspection wait time | `25000` |
| `DOWNLOAD_TIMEOUT_MS` | Hard limit before yt-dlp is killed | `1200000` |
| `RATE_LIMIT_MAX` | API requests per window | `20` |
| `RATE_LIMIT_WINDOW` | Rate limit window | `1 minute` |
| `CLOUDFLARED_TOKEN` | Cloudflare Tunnel token | required |

## Security Model

- Cloudflare Access is the authentication layer (no app-local password system). The app validates the Access JWT itself — it does not assume the tunnel makes the API safe.
- All `/api/*` and `/download/*` endpoints require a validated identity.
- Job IDs and download tokens are cryptographically random and short-lived.
- Jobs are linked to the authenticated user identity; another user cannot poll, cancel, or download them.
- Download links are one-time: the file and job are removed when the response finishes or the client disconnects, and again on expiry/cleanup.
- User input never becomes command-line flags. UI choices map to fixed backend format presets; the URL is always passed after `--`.
- URL validation rejects non-http(s) schemes, credentials in URLs, localhost/`.local`, and private, loopback, link-local, carrier-grade-NAT, unique-local, multicast, and reserved IP ranges (IPv4 and IPv6, including IPv4-mapped IPv6 such as the cloud metadata address).
- yt-dlp/FFmpeg run under a hard wall-clock timeout (SIGTERM then SIGKILL) with an early `--max-filesize` guard, so a hung or oversized download cannot wedge a slot or fill the disk.
- Containers run as a non-root user with `no-new-privileges`, all Linux capabilities dropped, and a read-only root filesystem (only the media volume and a `tmpfs` `/tmp` are writable).

### Known residual risks

- **SSRF via redirects / DNS rebinding:** the API validates the submitted URL and its resolved addresses, but yt-dlp performs its own DNS resolution and follows redirects, which this app does not intercept. A hostile site could in principle redirect to, or re-resolve to, an internal address. The container's dropped capabilities, read-only filesystem, and (recommended) isolated Docker network limit the blast radius. For stronger protection, place the worker on a network namespace with no route to internal services / the metadata endpoint.
- This project does not claim to be perfectly secure. Keep `yt-dlp` and base images updated.

## Limitations

- One video at a time per user by default.
- A single worker processes link inspection and downloads sequentially, so while one download runs, new link previews wait their turn. This keeps a small VPS predictable; run more `worker` replicas if you need more throughput.
- Playlists are deliberately disabled.
- No retained download library or history.
- No cookies, private account sessions, DRM bypassing, or CAPTCHA bypassing.
- `yt-dlp` compatibility depends on public site behavior. Update the pinned `YT_DLP_VERSION` build argument when needed.

## Tests

```bash
npm test
```

Tests cover:

- URL / SSRF validation, including IPv4-mapped IPv6 and metadata-address blocking
- Cloudflare Access JWT validation (signature, issuer, audience, expiry, identity claim)
- Job ownership, expiry, and the one-time download projection (no token leak until ready)
- Format-preset mapping and filename sanitization (path traversal / injection)
