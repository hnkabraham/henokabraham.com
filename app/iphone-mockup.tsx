import Image from 'next/image';

// A stylised iPhone 17 Pro frame in Cosmic Orange, built entirely from CSS —
// no Apple render or third-party mockup asset, since this repo ships under
// MIT and those aren't licensed for redistribution. Every measurement in
// iphone-mockup.css is a percentage of its own fixed aspect ratio, so this
// reads as a phone from the ~25px scroll-card teaser up to the ~170px
// project-briefing image; `compact` only swaps the drop shadow, which can't
// itself be expressed in %, for a lighter preset sized for the small teaser.
export default function IPhoneMockup({
  src,
  alt,
  width,
  height,
  compact = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  compact?: boolean;
}) {
  return (
    <span
      className={`iphone-mockup${compact ? ' iphone-mockup--compact' : ''}`}
    >
      <span className="iphone-mockup-shape" aria-hidden="true" />
      <span className="iphone-mockup-screen">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          unoptimized
          loading="lazy"
          className="iphone-mockup-img"
        />
        <span className="iphone-mockup-island" aria-hidden="true" />
      </span>
      <span
        className="iphone-mockup-button iphone-mockup-action"
        aria-hidden="true"
      />
      <span
        className="iphone-mockup-button iphone-mockup-volume-up"
        aria-hidden="true"
      />
      <span
        className="iphone-mockup-button iphone-mockup-volume-down"
        aria-hidden="true"
      />
      <span
        className="iphone-mockup-button iphone-mockup-camera-control"
        aria-hidden="true"
      />
      <span
        className="iphone-mockup-button iphone-mockup-power"
        aria-hidden="true"
      />
    </span>
  );
}
