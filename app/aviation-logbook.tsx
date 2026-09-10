import { aviationLogbook } from './aviation-logbook-data';
import Image from 'next/image';

const labels = {
  'site-reference': 'SITE REFERENCE',
  'personal-entry': 'PERSONAL ENTRY',
  sample: 'SAMPLE / TO BE REPLACED',
};

export default function AviationLogbook({
  onProject,
}: {
  onProject: (id: string) => void;
}) {
  return (
    <section
      className="aviation-logbook terminal-section"
      id="logbook"
      aria-labelledby="logbook-title"
    >
      <div className="terminal-section-top">
        <div>
          <p className="eyebrow">AIRCRAFT / AIRPORTS / NOTES</p>
          <h2 id="logbook-title">Personal aviation logbook</h2>
        </div>
        <p className="terminal-caption">
          Opening with the site’s aviation references.
          <br />
          Personal flight dates and records have not been added.
        </p>
      </div>
      <div className="logbook-entries">
        {aviationLogbook.map((entry) => (
          <article className="logbook-entry" key={entry.id}>
            <div className="logbook-meta mono">
              <span>{labels[entry.kind]}</span>
              {entry.date ? (
                <time dateTime={entry.date}>{entry.date}</time>
              ) : (
                <span>DATE / NOT RECORDED</span>
              )}
            </div>
            <div className="logbook-note">
              <h3>{entry.title}</h3>
              <dl>
                <div>
                  <dt>Aircraft</dt>
                  <dd>{entry.aircraft.join(' · ') || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Airports</dt>
                  <dd>
                    {entry.airports
                      .map((airport) => `${airport.code} / ${airport.name}`)
                      .join(' · ') || 'No individual airport recorded'}
                  </dd>
                </div>
              </dl>
              <p>{entry.note}</p>
              <small>Source: {entry.source}</small>
              {entry.projectId && (
                <button
                  className="logbook-project mono"
                  onClick={() => onProject(entry.projectId!)}
                >
                  View related project →
                </button>
              )}
            </div>
            <div className="logbook-photos">
              {entry.photos.length === 0 ? (
                <span className="mono logbook-photo-empty">PHOTO / —</span>
              ) : (
                entry.photos.map((photo) => (
                  <figure key={photo.src}>
                    <Image
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width}
                      height={photo.height}
                      loading="lazy"
                      decoding="async"
                      unoptimized
                    />
                    {photo.caption && <figcaption>{photo.caption}</figcaption>}
                  </figure>
                ))
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
