'use client';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ArrowUpRight, Radio, Send, Wind } from 'lucide-react';
import type { Weather, ProjectLive } from '@/server/live';
import {
  edgeConfig,
  measurementAllowed,
  type EdgeConfig,
} from '@/lib/flight-metrics';

type LiveData = {
  weather: Weather | null;
  projects: { checkedAt: string; projects: ProjectLive[] } | null;
};
export function useAirportLive() {
  const [data, setData] = useState<LiveData | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const update = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/api/live', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!r.ok) throw new Error('Feed unavailable');
        setData(await r.json());
        setNow(Date.now());
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void update();
    const poll = setInterval(update, 15 * 60000);
    const clock = setInterval(() => setNow(Date.now()), 60000);
    const visibility = () => {
      if (!document.hidden) {
        setNow(Date.now());
        void update();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.abort();
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return { data, failed, now };
}
const utc = (date: string) =>
  new Date(date).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
// METAR reports temperature in Celsius the world over; the page reads in
// Fahrenheit, like every other unit it shows.
const fahrenheit = (celsius: number) => Math.round((celsius * 9) / 5 + 32);
const calendar = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
export function LiveAtSfo({
  data,
  failed,
  now,
}: ReturnType<typeof useAirportLive>) {
  const weather = data?.weather;
  const age = weather && now ? now - Date.parse(weather.observedAt) : 0;
  const expired = age > 24 * 3600000;
  const stale = failed || age > 2 * 3600000;
  return (
    <section className="sfo-conditions" aria-labelledby="sfo-conditions-title">
      <div className="sfo-station">
        <p className="eyebrow">
          <Radio size={15} /> AIRPORT CONDITIONS
        </p>
        <h2 id="sfo-conditions-title">Live at SFO</h2>
        <span className="mono">KSFO · SAN FRANCISCO</span>
      </div>
      {weather && !expired ? (
        <>
          <dl className="sfo-readings">
            <div>
              <dt>Temperature</dt>
              <dd>
                {weather.temperatureC === null
                  ? '—'
                  : `${fahrenheit(weather.temperatureC)}°F`}
              </dd>
            </div>
            <div>
              <dt>
                <Wind size={14} /> Wind
              </dt>
              <dd>
                {weather.windKnots === null
                  ? '—'
                  : weather.windKnots === 0
                    ? 'Calm'
                    : `${weather.windDegrees === null ? 'Variable' : String(weather.windDegrees).padStart(3, '0') + '°'} / ${weather.windKnots} kt`}
                {weather.gustKnots !== null && (
                  <small>Gusting {weather.gustKnots} kt</small>
                )}
              </dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>
                {weather.visibilityMiles === null
                  ? '—'
                  : `${weather.visibilityMiles} mi`}
              </dd>
            </div>
            <div>
              <dt>Flight conditions</dt>
              <dd>{weather.category || '—'}</dd>
            </div>
          </dl>
          <div className="sfo-source">
            <p>
              {stale ? 'Last available report' : 'Observed'}{' '}
              <time dateTime={weather.observedAt}>
                {utc(weather.observedAt)}
              </time>
              {stale && ` · ${calendar(weather.observedAt)}`}
            </p>
            <a
              href="https://aviationweather.gov/data/metar/?id=KSFO"
              target="_blank"
              rel="noopener noreferrer"
            >
              Aviation Weather Center <ArrowUpRight size={14} />
            </a>
            <details>
              <summary>Read the METAR</summary>
              <p>{weather.raw}</p>
            </details>
          </div>
        </>
      ) : (
        <output className="sfo-feed-note">
          {failed || data
            ? 'Weather temporarily unavailable.'
            : 'Loading weather…'}
        </output>
      )}
      <p className="sfo-scene-note">Scene weather is cinematic.</p>
    </section>
  );
}
export function ProjectUpdate({
  item,
  now,
}: {
  item?: ProjectLive;
  now: number;
}) {
  if (!item) return null;
  const stale = now - Date.parse(item.checkedAt) > 45 * 60000;
  return (
    <div className="project-live-update">
      <p className="mono">
        {stale ? 'LAST CHECK' : 'LATEST CHECK'} ·{' '}
        <time dateTime={item.checkedAt}>
          {calendar(item.checkedAt)} · {utc(item.checkedAt)}
        </time>
      </p>
      {item.reachable !== undefined && (
        <span>
          {stale ? 'Previous check: ' : ''}
          {item.reachable === true
            ? 'Website reachable'
            : item.reachable === false
              ? 'Website returned a server error'
              : 'Availability could not be verified'}
        </span>
      )}
      {item.updatedAt && (
        <span>Repository updated {calendar(item.updatedAt)}</span>
      )}
      {item.release && (
        <a href={item.release.url} target="_blank" rel="noopener noreferrer">
          Latest release: {item.release.name} <ArrowUpRight size={14} />
        </a>
      )}
      {item.metadataAvailable === false && (
        <span>Repository updates are temporarily unavailable.</span>
      )}
    </div>
  );
}
export function SourceUpdate({ item }: { item?: ProjectLive }) {
  return item?.updatedAt ? (
    <span className="source-live">
      Updated {calendar(item.updatedAt)}
      {item.release ? ` · ${item.release.name}` : ''}
    </span>
  ) : null;
}

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let turnstileRequest: Promise<void> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return (turnstileRequest ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Verification timeout'));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Verification unavailable'));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    turnstileRequest = undefined;
    throw error;
  }));
}
export function ContactTower() {
  const root = useRef<HTMLFormElement>(null);
  const challenge = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [near, setNear] = useState(false);
  const [config, setConfig] = useState<EdgeConfig | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let stopped = false;
    void edgeConfig()
      .then(async (c) => {
        if (stopped) return;
        setConfig(c);
        if (!c.contactEnabled || !c.turnstileSiteKey)
          throw new Error(
            'The tower is temporarily unavailable. You can still find me on GitHub.',
          );
        await loadTurnstile();
        if (stopped || !challenge.current || !window.turnstile) return;
        widget.current = window.turnstile.render(challenge.current, {
          sitekey: c.turnstileSiteKey,
          action: 'contact',
          theme: 'light',
          size: 'flexible',
          callback: (value: string) => {
            setToken(value);
            setMessage('');
          },
          'expired-callback': () => {
            setToken('');
            setMessage('Verification expired. Please verify again.');
          },
          'error-callback': () => {
            setToken('');
            setMessage('Verification could not load. Please retry.');
          },
        });
      })
      .catch((e: Error) => {
        if (!stopped) setMessage(e.message);
      });
    return () => {
      stopped = true;
      if (widget.current) {
        window.turnstile?.remove(widget.current);
        widget.current = null;
      }
    };
  }, [near, retry]);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !token) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          name: values.get('name'),
          email: values.get('email'),
          message: values.get('message'),
          token,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || 'Your message could not be sent. Please try again.',
        );
      // The verification container unmounts with the form, so drop the widget
      // now rather than reset it below, or remove it later, on missing DOM.
      if (widget.current) {
        window.turnstile?.remove(widget.current);
        widget.current = null;
      }
      setSent(true);
      form.reset();
      setMessage('Message sent. Thanks for saying hello!');
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : 'Connection interrupted. Please try again.',
      );
    } finally {
      setBusy(false);
      setToken('');
      if (widget.current) window.turnstile?.reset(widget.current);
    }
  };
  return (
    <form
      className="tower-form"
      ref={root}
      onSubmit={submit}
      aria-labelledby="tower-form-title"
    >
      <h3 id="tower-form-title">
        <Radio size={19} /> Contact the tower
      </h3>
      {!sent && (
        <>
          <div className="tower-field-pair">
            <label>
              Your name
              <input
                name="name"
                autoComplete="name"
                maxLength={100}
                required
                disabled={busy}
              />
            </label>
            <label>
              Your email
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                disabled={busy}
              />
            </label>
          </div>
          <label>
            Message
            <textarea
              name="message"
              rows={4}
              minLength={10}
              maxLength={5000}
              required
              disabled={busy}
            />
          </label>
          <div className="tower-verification" ref={challenge} />
          <button
            className="tower-send"
            disabled={!config?.contactEnabled || !token || busy}
            type="submit"
          >
            <Send size={17} /> {busy ? 'Transmitting…' : 'Send message'}
          </button>
          <p className="tower-privacy">
            Your message goes to Henok’s inbox. Cloudflare Turnstile helps
            filter spam.
          </p>
        </>
      )}
      {message && (
        <output className={`tower-response ${sent ? 'sent' : ''}`}>
          {message}
        </output>
      )}
      {!sent && message && !token && (
        <button
          className="tower-retry"
          type="button"
          onClick={() => {
            setToken('');
            setMessage('');
            setRetry((v) => v + 1);
          }}
        >
          Retry verification
        </button>
      )}
      {sent && (
        <button
          className="tower-retry"
          type="button"
          onClick={() => {
            setSent(false);
            setRetry((v) => v + 1);
          }}
        >
          Send another message
        </button>
      )}
    </form>
  );
}
export function FlightMeasurements() {
  useEffect(() => {
    if (!measurementAllowed()) return;
    let stopped = false;
    void edgeConfig()
      .then((config) => {
        if (
          stopped ||
          !measurementAllowed() ||
          !config.analyticsToken ||
          document.getElementById('flight-web-analytics')
        )
          return;
        const script = document.createElement('script');
        script.id = 'flight-web-analytics';
        script.defer = true;
        script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        script.dataset.cfBeacon = JSON.stringify({
          token: config.analyticsToken,
          spa: true,
        });
        document.head.appendChild(script);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
  return null;
}
