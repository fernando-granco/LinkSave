import React from 'react';
import ReactDOM from 'react-dom/client';
import { Download, Music, Video, CheckCircle2, AlertCircle } from 'lucide-react';
import './styles.css';

type Mode = 'video' | 'audio';
type Quality = 'best' | '1080p' | '720p' | '480p' | 'mp3' | 'best-audio';
type JobStatus = 'queued' | 'checking' | 'downloading' | 'preparing' | 'ready' | 'failed' | 'expired';

interface Metadata {
  title: string;
  thumbnail?: string;
  durationSeconds?: number;
  sourceName: string;
  webpageUrl: string;
}

interface Job {
  id: string;
  status: JobStatus;
  mode: Mode;
  quality: Quality;
  metadata?: Metadata;
  errorMessage?: string;
  downloadUrl?: string;
  expiresAt: number;
}

const videoOptions: Array<{ value: Quality; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' }
];

const audioOptions: Array<{ value: Quality; label: string }> = [
  { value: 'mp3', label: 'MP3' },
  { value: 'best-audio', label: 'Best audio' }
];

function formatDuration(seconds?: number): string | undefined {
  if (!seconds) return undefined;
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (minutes < 60) return `${minutes}:${remaining.toString().padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
}

function friendlyStatus(status?: JobStatus, inspecting?: boolean): string {
  if (inspecting) return 'Checking link';
  if (!status) return 'Ready when you are';
  if (status === 'queued') return 'Waiting for a turn';
  if (status === 'checking') return 'Checking link';
  if (status === 'downloading') return 'Downloading';
  if (status === 'preparing') return 'Preparing file';
  if (status === 'ready') return 'Ready to download';
  if (status === 'expired') return 'This download expired';
  return 'Could not finish';
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data as T;
}

function App() {
  const [url, setUrl] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('video');
  const [quality, setQuality] = React.useState<Quality>('best');
  const [metadata, setMetadata] = React.useState<Metadata | undefined>();
  const [job, setJob] = React.useState<Job | undefined>();
  const [checking, setChecking] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [downloadStartedFor, setDownloadStartedFor] = React.useState<string | undefined>();

  const options = mode === 'video' ? videoOptions : audioOptions;

  React.useEffect(() => {
    setQuality(mode === 'video' ? 'best' : 'mp3');
  }, [mode]);

  React.useEffect(() => {
    setMetadata(undefined);
    setJob(undefined);
    setMessage('');
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const result = await api<{ metadata: Metadata }>('/api/inspect', {
          method: 'POST',
          body: JSON.stringify({ url: trimmed }),
          signal: controller.signal
        });
        setMetadata(result.metadata);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'I could not read that link.');
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 600);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url]);

  React.useEffect(() => {
    if (!job || ['ready', 'failed', 'expired'].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await api<{ job: Job }>(`/api/jobs/${job.id}`);
        setJob(result.job);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'I lost track of that download.');
        window.clearInterval(timer);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job]);

  React.useEffect(() => {
    if (job?.status === 'ready' && job.downloadUrl && downloadStartedFor !== job.id) {
      setDownloadStartedFor(job.id);
      window.location.assign(job.downloadUrl);
    }
  }, [job, downloadStartedFor]);

  async function startDownload() {
    setMessage('');
    setJob(undefined);
    setDownloadStartedFor(undefined);
    try {
      const result = await api<{ job: Job }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), mode, quality })
      });
      setJob(result.job);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The download could not be started.');
    }
  }

  const canDownload = /^https?:\/\//i.test(url.trim()) && !checking && (!job || ['ready', 'failed', 'expired'].includes(job.status));
  const duration = formatDuration(metadata?.durationSeconds);

  return (
    <main className="page">
      <section className="panel" aria-labelledby="title">
        <div className="topline">
          <h1 id="title">LinkSave</h1>
          <strong className="subtitle">Family Downloader</strong>
          <p>Only download content you are allowed to save.</p>
        </div>

        <label className="input-label" htmlFor="video-url">
          Paste a video link
        </label>
        <input
          id="video-url"
          className="url-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
          inputMode="url"
          autoComplete="off"
        />

        <div className="controls">
          <div className="segmented" aria-label="Download type">
            <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')} type="button">
              <Video size={24} aria-hidden /> Video
            </button>
            <button className={mode === 'audio' ? 'active' : ''} onClick={() => setMode('audio')} type="button">
              <Music size={24} aria-hidden /> Audio
            </button>
          </div>

          <div className="choices" aria-label="Quality">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={quality === option.value ? 'active' : ''}
                onClick={() => setQuality(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {(metadata || checking) && (
          <div className="preview">
            {metadata?.thumbnail ? <img src={metadata.thumbnail} alt="" /> : <div className="placeholder" />}
            <div>
              <div className="source">{metadata?.sourceName || 'Checking'}</div>
              <h2>{metadata?.title || 'Checking this link...'}</h2>
              {duration && <p>{duration}</p>}
            </div>
          </div>
        )}

        <div className="status" role="status" aria-live="polite">
          {job?.status === 'ready' ? <CheckCircle2 size={26} aria-hidden /> : null}
          {message || job?.errorMessage ? <AlertCircle size={26} aria-hidden /> : null}
          <span>{message || job?.errorMessage || friendlyStatus(job?.status, checking)}</span>
        </div>

        <button className="download-button" type="button" disabled={!canDownload} onClick={startDownload}>
          <Download size={28} aria-hidden />
          Download
        </button>

        {job?.status === 'ready' && job.downloadUrl && (
          <a className="ready-link" href={job.downloadUrl}>
            Download again
          </a>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
