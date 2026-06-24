FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build
RUN mkdir -p apps/api/dist/public && cp -r apps/web/dist/* apps/api/dist/public/

FROM node:20-bookworm-slim AS runtime
ARG YT_DLP_VERSION=2026.6.9
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
  && python3 -m venv /opt/ytdlp \
  && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp==${YT_DLP_VERSION}" \
  && ln -s /opt/ytdlp/bin/yt-dlp /usr/local/bin/yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --omit=dev --workspace apps/api \
  && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist

# Create the temp media directory in the image so the named volume inherits
# appuser ownership on first mount (the container runs read-only otherwise).
RUN groupadd --gid 10001 appuser \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser \
  && mkdir -p /data/media \
  && chown -R appuser:appuser /app /data

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
