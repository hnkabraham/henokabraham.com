import './not-found.css';

// A wrong address lands on the same opening sky as the tour, with the three
// places a visitor is most likely to have wanted. The framework's default
// is a bare white page; this one keeps the field's voice.
export const metadata = { title: 'Diverted — Henok Abraham' };

export default function NotFound() {
  return (
    <main className="diverted">
      <div className="bay-opening-sky" aria-hidden="true">
        <div className="bay-poster">
          <div className="bay-landmark" />
        </div>
        <div className="bay-opening-cloud bay-opening-cloud-far" />
        <div className="bay-opening-cloud bay-opening-cloud-near" />
      </div>
      <div className="diverted-card">
        <p className="diverted-eyebrow mono">404 · DIVERTED</p>
        <h1>No such gate.</h1>
        <p>
          This address doesn’t land anywhere on the field. Everything is one
          hop away: the tour, the projects and the flight log.
        </p>
        {/* Plain anchors: the 404 boundary renders outside the client
            navigation runtime, where next/link's prefetch throws, and a full
            load of the home page is what a wrong address needs anyway. */}
        {/* oxlint-disable next/no-html-link-for-pages */}
        <nav aria-label="Where to next">
          <a className="diverted-link" href="/">
            Back to the open sky
          </a>
          <a className="diverted-link" href="/#departures">
            Projects
          </a>
          <a className="diverted-link" href="/?chapter=bay">
            Flight log
          </a>
        </nav>
        {/* oxlint-enable next/no-html-link-for-pages */}
      </div>
    </main>
  );
}
