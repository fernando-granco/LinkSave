# LinkSave

LinkSave is a small, self-hosted app for downloading public videos or audio from a browser. Paste a link, choose a format and quality, and download the file.

It is designed for personal or family use, either on a trusted network or behind Cloudflare Access.

> Only download content you have permission to save. LinkSave does not support private accounts, cookies, DRM-protected media, or CAPTCHA bypassing.

## Screenshots

<p align="center">
  <img src="screenshot0.png" alt="LinkSave download screen" width="48%">
  <img src="screenshot1.png" alt="LinkSave settings" width="48%">
</p>

## Features

- Video and audio downloads powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- MP4, MP3, and M4A output
- Optional 4K downloads
- Link previews before downloading
- Temporary files are removed after download or expiry
- Per-user and global download limits
- Optional Cloudflare Access authentication

## Run with Docker

You will need Docker and a Cloudflare Tunnel.

```bash
git clone https://github.com/fernando-granco/LinkSave.git
cd LinkSave
cp .env.example .env
```

Edit `.env` and set at least:

```env
PUBLIC_BASE_URL=https://download.example.com
CLOUDFLARED_TOKEN=your-tunnel-token
CF_ACCESS_TEAM_DOMAIN=your-team-name
CF_ACCESS_AUD=your-access-application-audience
```

Then start the app:

```bash
docker compose up -d --build
```

The Compose setup runs the web app, API, download worker, Redis, and Cloudflare Tunnel. The app and Redis are not exposed directly to the internet.

## Configuration

Common settings are listed below. See [.env.example](.env.example) for every option.

| Variable | Default | Description |
| --- | --- | --- |
| `REQUIRE_CLOUDFLARE_ACCESS` | `true` | Require a valid Cloudflare Access login |
| `MAX_GLOBAL_CONCURRENT_JOBS` | `2` | Maximum active downloads across all users |
| `MAX_CONCURRENT_JOBS_PER_USER` | `1` | Maximum active downloads per user |
| `MAX_VIDEO_DURATION_SECONDS` | `7200` | Longest allowed video |
| `MAX_FILE_SIZE_BYTES` | `2147483648` | Largest allowed file (2 GB) |
| `JOB_EXPIRATION_SECONDS` | `900` | How long completed downloads remain available |
| `ALLOW_4K` | `true` | Show the 4K quality option |
| `YT_DLP_AUTO_UPDATE` | `true` | Update yt-dlp on worker startup and once a day |

## Notes

- Playlists are disabled.
- Downloads are processed one at a time per worker.
- Media files are temporary; LinkSave is not a media library.
- URL checks block local and private network addresses, but no self-hosted downloader should be treated as risk-free. Keep the app private and its images up to date.

## Security

LinkSave has no built-in user accounts or password login. Keep it on a private network or place it behind Cloudflare Access, a trusted VPN, or an authenticated reverse proxy. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

LinkSave is available under the [MIT License](LICENSE).
