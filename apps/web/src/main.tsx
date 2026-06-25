import React from 'react';
import ReactDOM from 'react-dom/client';
import { ArrowDownToLine, Music, Film, Check, AlertCircle, Sun, Moon, Monitor, Settings2 } from 'lucide-react';
import './styles.css';

type Mode = 'video' | 'audio';
type VideoQuality = 'best' | '1080p' | '720p' | '480p';
type AudioFormat = 'mp3' | 'm4a';
type Mp3Bitrate = '128' | '192' | '320';
type Quality = VideoQuality | 'm4a' | `mp3-${Mp3Bitrate}`;
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

const videoOptions: Array<{ value: VideoQuality; label: string }> = [
  { value: 'best', label: 'Best' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' }
];

const audioOptions: Array<{ value: AudioFormat; label: string }> = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A' }
];

const mp3Bitrates: Mp3Bitrate[] = ['128', '192', '320'];

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
  if (inspecting) return 'Checking the link…';
  if (!status) return 'Paste a link to begin';
  if (status === 'queued') return 'Waiting for a turn…';
  if (status === 'checking') return 'Checking the link…';
  if (status === 'downloading') return 'Downloading…';
  if (status === 'preparing') return 'Preparing your file…';
  if (status === 'ready') return 'Your download is ready';
  if (status === 'expired') return 'This download expired';
  return 'Sorry, that did not work';
}

type Theme = 'system' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'linksave-theme';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // localStorage may be unavailable (private mode); fall back to system.
  }
  return 'system';
}

/**
 * Theme preference that defaults to the OS setting. The choice is applied by
 * setting `data-theme` on <html> (also done pre-paint in index.html to avoid a
 * flash) and, while on "system", follows live OS changes.
 */
function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = React.useState<Theme>(readStoredTheme);

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; the in-memory choice still applies.
    }
    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [theme]);

  return [theme, setTheme];
}

/** A small preference remembered in localStorage. */
function usePersistentChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) return stored as T;
    } catch {
      // ignore
    }
    return fallback;
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // ignore
    }
  };
  return [value, set];
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

interface SettingsProps {
  theme: Theme;
  onTheme: (next: Theme) => void;
  show4k: boolean;
  allow4k: boolean;
  onAllow4k: (next: boolean) => void;
  mp3Bitrate: Mp3Bitrate;
  onMp3Bitrate: (next: Mp3Bitrate) => void;
}

const themeChoices: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: 'system', label: 'Auto', icon: <Monitor size={16} aria-hidden /> },
  { value: 'light', label: 'Light', icon: <Sun size={16} aria-hidden /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} aria-hidden /> }
];

/** The semi-hidden settings popover, opened from the gear button. */
function SettingsMenu(props: SettingsProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="settings" ref={containerRef}>
      <button
        type="button"
        className="icon-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen((value) => !value)}
      >
        <Settings2 size={19} aria-hidden />
      </button>

      {open && (
        <div className="settings-pop" role="dialog" aria-label="Settings">
          <div className="settings-group">
            <span className="settings-label">Appearance</span>
            <div className="seg-small" role="group" aria-label="Appearance">
              {themeChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={props.theme === choice.value ? 'active' : ''}
                  aria-pressed={props.theme === choice.value}
                  onClick={() => props.onTheme(choice.value)}
                >
                  {choice.icon}
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          {props.show4k && (
            <div className="settings-group">
              <span className="settings-label">Best video quality</span>
              <div className="seg-small" role="group" aria-label="Best video quality">
                <button
                  type="button"
                  className={!props.allow4k ? 'active' : ''}
                  aria-pressed={!props.allow4k}
                  onClick={() => props.onAllow4k(false)}
                >
                  Up to 1080p
                </button>
                <button
                  type="button"
                  className={props.allow4k ? 'active' : ''}
                  aria-pressed={props.allow4k}
                  onClick={() => props.onAllow4k(true)}
                >
                  Up to 4K
                </button>
              </div>
              <span className="settings-hint">4K files are much larger.</span>
            </div>
          )}

          <div className="settings-group">
            <span className="settings-label">MP3 quality</span>
            <div className="seg-small" role="group" aria-label="MP3 quality">
              {mp3Bitrates.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={props.mp3Bitrate === rate ? 'active' : ''}
                  aria-pressed={props.mp3Bitrate === rate}
                  onClick={() => props.onMp3Bitrate(rate)}
                >
                  {rate}
                </button>
              ))}
            </div>
            <span className="settings-hint">Higher kbps sounds better and is bigger.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [theme, setTheme] = useTheme();
  const [serverAllow4k, setServerAllow4k] = React.useState(false);
  const [allow4k, setAllow4k] = usePersistentChoice<'on' | 'off'>('linksave-4k', ['on', 'off'], 'off');
  const [mp3Bitrate, setMp3Bitrate] = usePersistentChoice<Mp3Bitrate>('linksave-mp3', mp3Bitrates, '192');

  const [url, setUrl] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('video');
  const [videoQuality, setVideoQuality] = React.useState<VideoQuality>('best');
  const [audioFormat, setAudioFormat] = React.useState<AudioFormat>('mp3');
  const [metadata, setMetadata] = React.useState<Metadata | undefined>();
  const [job, setJob] = React.useState<Job | undefined>();
  const [checking, setChecking] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [downloadStartedFor, setDownloadStartedFor] = React.useState<string | undefined>();

  // Ask the server which optional features to show (e.g. whether 4K is enabled).
  React.useEffect(() => {
    api<{ allow4k: boolean }>('/api/options')
      .then((result) => setServerAllow4k(Boolean(result.allow4k)))
      .catch(() => setServerAllow4k(false));
  }, []);

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

  const allow4kEffective = serverAllow4k && allow4k === 'on';

  function currentQuality(): Quality {
    if (mode === 'video') return videoQuality;
    return audioFormat === 'm4a' ? 'm4a' : (`mp3-${mp3Bitrate}` as Quality);
  }

  async function startDownload() {
    setMessage('');
    setJob(undefined);
    setDownloadStartedFor(undefined);
    try {
      const result = await api<{ job: Job }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          mode,
          quality: currentQuality(),
          allowHighRes: mode === 'video' && videoQuality === 'best' && allow4kEffective
        })
      });
      setJob(result.job);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The download could not be started.');
    }
  }

  const canDownload =
    /^https?:\/\//i.test(url.trim()) && !checking && (!job || ['ready', 'failed', 'expired'].includes(job.status));
  const duration = formatDuration(metadata?.durationSeconds);
  const busy = Boolean(job && !['ready', 'failed', 'expired'].includes(job.status));

  // A short, friendly description of what the chosen option will produce.
  const choiceHint =
    mode === 'video'
      ? videoQuality === 'best'
        ? `Best available, up to ${allow4kEffective ? '4K' : '1080p'}`
        : `Up to ${videoQuality}`
      : audioFormat === 'm4a'
        ? 'Original audio (M4A)'
        : `MP3 at ${mp3Bitrate} kbps`;

  return (
    <main className="page">
      <section className="panel" aria-labelledby="title">
        <header className="brand">
          <span className="brand-mark" aria-hidden>
            <ArrowDownToLine size={22} />
          </span>
          <div className="brand-text">
            <h1 id="title">LinkSave</h1>
            <span className="subtitle">Save a video or its audio</span>
          </div>
          <SettingsMenu
            theme={theme}
            onTheme={setTheme}
            show4k={serverAllow4k}
            allow4k={allow4k === 'on'}
            onAllow4k={(next) => setAllow4k(next ? 'on' : 'off')}
            mp3Bitrate={mp3Bitrate}
            onMp3Bitrate={setMp3Bitrate}
          />
        </header>

        <div className="field">
          <label className="field-label" htmlFor="video-url">
            Paste a link
          </label>
          <input
            id="video-url"
            className="url-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="controls">
          <div className="seg" role="group" aria-label="What to save">
            <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')} type="button">
              <Film size={20} aria-hidden /> Video
            </button>
            <button className={mode === 'audio' ? 'active' : ''} onClick={() => setMode('audio')} type="button">
              <Music size={20} aria-hidden /> Audio
            </button>
          </div>

          <div className="choices" role="group" aria-label="Quality">
            {mode === 'video'
              ? videoOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={videoQuality === option.value ? 'active' : ''}
                    onClick={() => setVideoQuality(option.value)}
                  >
                    {option.label}
                  </button>
                ))
              : audioOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={audioFormat === option.value ? 'active' : ''}
                    onClick={() => setAudioFormat(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
          </div>
          <p className="choice-hint">{choiceHint}</p>
        </div>

        {(metadata || checking) && (
          <div className="preview">
            {metadata?.thumbnail ? <img src={metadata.thumbnail} alt="" /> : <div className="placeholder" />}
            <div className="preview-text">
              <div className="source">{metadata?.sourceName || 'Checking'}</div>
              <h2>{metadata?.title || 'Checking this link…'}</h2>
              {duration && <p>{duration}</p>}
            </div>
          </div>
        )}

        <button className="download-button" type="button" disabled={!canDownload} onClick={startDownload}>
          {busy ? (
            <span className="spinner" aria-hidden />
          ) : (
            <ArrowDownToLine size={24} aria-hidden />
          )}
          {busy ? 'Working…' : 'Download'}
        </button>

        <div className="status" role="status" aria-live="polite">
          {job?.status === 'ready' ? <Check size={18} aria-hidden className="status-ok" /> : null}
          {message || job?.errorMessage ? <AlertCircle size={18} aria-hidden className="status-warn" /> : null}
          <span>{message || job?.errorMessage || friendlyStatus(job?.status, checking)}</span>
        </div>

        {job?.status === 'ready' && job.downloadUrl && (
          <a className="ready-link" href={job.downloadUrl}>
            Download didn’t start? Tap here
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
