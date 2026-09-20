import {
  ArrowLeftRight,
  Bluetooth,
  Box,
  ScanLine,
  Smartphone,
  Watch,
} from 'lucide-react';
import type { Flight } from './flight-data';

/** Real captures where available; small illustrations for unreleased tools. */
export default function ProjectPreview({ flight }: { flight: Flight }) {
  if (flight.preview)
    return (
      <span className={`project-visual project-visual-${flight.id}`}>
        <picture>
          {flight.preview.avif && (
            <source srcSet={flight.preview.avif} type="image/avif" />
          )}
          <img
            src={flight.preview.src}
            alt={flight.preview.alt}
            width={640}
            height={400}
            loading="lazy"
            decoding="async"
          />
        </picture>
      </span>
    );
  return (
    <span
      className={`project-visual project-visual-${flight.id}`}
      aria-hidden="true"
    >
      {flight.id === 'wear-bridge' ? (
        <>
          <span className="preview-devices">
            <Smartphone size={70} strokeWidth={1.1} />
            <span className="preview-connection">
              <Bluetooth size={19} />
              <ArrowLeftRight size={34} strokeWidth={1.2} />
            </span>
            <Watch size={60} strokeWidth={1.1} />
          </span>
          <span className="preview-caption">iPhone ↔ Wear OS</span>
        </>
      ) : flight.id === 'spoolbrush' ? (
        <>
          <span className="preview-mesh">
            <svg viewBox="0 0 160 120" fill="none">
              <path d="M80 5 144 40 80 77 16 40Z" fill="#f0b765" />
              <path d="M16 40 80 77 80 115 16 78Z" fill="#f1876e" />
              <path d="M80 77 144 40 144 78 80 115Z" fill="#80bebd" />
              <path
                d="M48 23 112 59M112 23 48 59M16 59 80 96 144 59M48 59V96M112 59V96M80 5V77"
                stroke="#173546"
                strokeOpacity=".35"
              />
            </svg>
            <span className="preview-palette">
              <i />
              <i />
              <i />
            </span>
          </span>
          <span className="preview-caption">Paint a mesh. Print in color.</span>
        </>
      ) : (
        <>
          <span className="preview-scanner">
            <ScanLine size={114} strokeWidth={0.7} />
            <Box size={65} strokeWidth={0.9} />
          </span>
          <span className="preview-caption">Capture the world in 3D.</span>
        </>
      )}
    </span>
  );
}
