export type Flight = {
  id: string;
  code: string;
  name: string;
  destination: string;
  category: string;
  gate: string;
  status: string;
  open: boolean;
  summary: string;
  story: string;
  stack: string[];
  url?: string;
  linkLabel?: string;
  // The project's own repository, offered beside `url` when that link goes
  // somewhere else (this site's briefing returns to the sky).
  source?: string;
  // A still from the project itself, shown in the briefing's side rail. The
  // rail is a narrow portrait frame, so captures are taken tall; its own
  // dimensions, caption and description travel with it rather than living in
  // the markup, which only had room for one project's.
  image?: {
    src: string;
    width: number;
    height: number;
    alt: string;
    caption: string;
  };
  preview?: { src: string; avif?: string; alt: string };
  features: string[];
};
export const flights: Flight[] = [
  {
    id: 'bay-departure',
    preview: {
      src: '/images/og-card.jpg',
      avif: '/images/og-card.avif',
      alt: 'Personal Airspace, Henok’s aviation-inspired website',
    },
    code: 'HA 006',
    name: 'Personal Airspace',
    destination: 'FEATURED ENGINEERING',
    category: 'WebGL / aircraft cinematography',
    gate: 'SFO',
    status: 'LIVE',
    open: true,
    summary: 'A 787. A moving sky. Built for the browser.',
    story:
      'A scroll-driven 787 flyby with detailed close-ups, custom livery, and adaptive graphics.',
    stack: ['TypeScript', 'Three.js', 'GLSL', 'Python'],
    url: '?project=bay-departure&chapter=preflight',
    linkLabel: 'Return to the open sky',
    source: 'https://github.com/hnkabraham/henokabraham.com',
    features: [
      '4K textures and modeled fan blades',
      'Engine, wing, and tail close-ups',
      'Daylight reflections and custom livery',
      'Adaptive graphics and reduced-motion support',
    ],
  },
  {
    id: 'flight-tracker',
    preview: {
      src: '/images/live-united-flight-tracker.jpg',
      avif: '/images/live-united-flight-tracker.avif',
      alt: 'United Flight Tracker showing live aircraft on a 3D globe',
    },
    code: 'HA 001',
    name: 'United Flight Tracker',
    destination: 'AVIATION',
    category: 'Web experience',
    gate: 'A01',
    status: 'LIVE',
    open: true,
    summary: 'Explore United’s fleet on a live 3D globe.',
    story:
      'An independent tracker for United and United Express. Live aircraft, fleet details, and airport weather on a 3D globe.',
    stack: ['3D visualization', 'Flight data', 'Python'],
    url: 'https://unitedflighttracker.com',
    linkLabel: 'Explore live project',
    features: [
      'Live aircraft tracking and a 3D globe',
      'Fleet insights and airport operations',
      'Weather layers and network views',
    ],
  },
  {
    id: 'routeloads',
    preview: {
      src: '/images/live-routeloads.jpg',
      avif: '/images/live-routeloads.avif',
      alt: 'routeloads route search and flight occupancy rankings',
    },
    code: 'HA 007',
    name: 'routeloads',
    destination: 'AVIATION',
    category: 'Route analytics',
    gate: 'A03',
    status: 'LIVE',
    open: true,
    summary: 'How full are flight routes in America?',
    story:
      'Seat occupancy, fares and on-time rates for every US route, from the DOT’s monthly filings. Free and public: no logins, no paywalls.',
    stack: ['Static HTML', 'DOT BTS T-100', 'Cloudflare'],
    url: 'https://routeloads.com',
    linkLabel: 'Explore live project',
    image: {
      src: '/images/routeloads-hero.jpg',
      width: 690,
      height: 1145,
      alt: 'routeloads’ route search, with passengers, average load factor, route pairs and years covered',
      caption: 'ROUTE SEARCH',
    },
    features: [
      '70,000+ route pairs, ranked by load factor, fare and seats',
      '600+ airport pages, carrier profiles and monthly reports',
      'A national map coloured by how full each route runs',
    ],
  },
  {
    id: 'bezel-auth',
    preview: {
      src: '/images/bezel-auth-lineup.jpg',
      avif: '/images/bezel-auth-lineup.avif',
      alt: 'Three Bezel Auth watch faces, Atelier, Summit and Prism, showing sample data',
    },
    code: 'HA 008',
    name: 'Bezel Auth',
    destination: 'WEARABLES',
    category: 'Garmin watch faces',
    gate: 'B03',
    status: 'LIVE',
    open: true,
    summary: 'Twenty watch faces. One optional authenticator.',
    story:
      'A free collection of twenty watch faces for the Garmin epix (Gen 2), on the Connect IQ store. Each can also show a two-factor code from one account you add yourself.',
    stack: ['Monkey C', 'Connect IQ', 'TOTP'],
    url: 'https://apps.garmin.com/developer/9547a1e5-162b-494c-8a14-024066f4f32f/apps',
    linkLabel: 'See all twenty on Connect IQ',
    image: {
      src: '/images/bezel-auth-faces.jpg',
      width: 690,
      height: 1035,
      alt: 'Six more Bezel Auth faces: Vector, Wayfinder, Nightwatch, Tactical, Chrono and Offset',
      caption: 'SAMPLE DATA',
    },
    features: [
      'Analog, digital and sports layouts, all free',
      'Optional code: off by default, shown only while awake',
      'Generated on the watch; no account, server or analytics',
    ],
  },
  {
    id: 'downshift',
    preview: {
      src: '/images/downshift-mockup-static.png',
      avif: '/images/downshift-mockup-static.avif',
      alt: 'Downshift’s dashboard, performance and settings screens on three iPhones',
    },
    code: 'HA 002',
    name: 'Downshift',
    destination: 'AUTOMOTIVE',
    category: 'Native iOS',
    gate: 'A02',
    status: 'IN THE HANGAR',
    open: false,
    summary: 'Live car data. Better shifts.',
    story:
      'An iOS driving companion with live OBD-II telemetry, shift coaching, and a car-free simulator.',
    stack: ['SwiftUI', 'OBD-II', 'CoreBluetooth'],
    image: {
      src: '/images/downshift-dashboard.jpg',
      width: 690,
      height: 1500,
      alt: 'Downshift’s simulated driving dashboard with RPM and shift coaching',
      caption: 'SIMULATOR MODE',
    },
    features: [
      'Live shift advisories and quality scoring',
      'Session recording, lap timing, and telemetry',
      'Simulator mode for testing without hardware',
    ],
  },
  {
    id: 'wear-bridge',
    code: 'HA 003',
    name: 'iPhone ↔ Wear OS',
    destination: 'CONNECTED DEVICES',
    category: 'Cross-platform',
    gate: 'B01',
    status: 'OPEN SOURCE',
    open: true,
    summary: 'Your iPhone. Your Wear OS watch. Connected.',
    story:
      'An encrypted iPhone–Wear OS bridge for notifications, health, calls, and music. Initial watch setup still needs Android.',
    stack: ['Swift', 'Kotlin', 'Bluetooth LE'],
    url: 'https://github.com/hnkabraham/wear-ios-bridge',
    linkLabel: 'Explore repository',
    features: [
      'Encrypted device-to-device communication',
      'iPhone notifications and health synchronization',
      'Beta; physical-device testing in progress',
    ],
  },
  {
    id: 'ct45-link',
    preview: {
      src: '/images/ct45-desktop.jpg',
      avif: '/images/ct45-desktop.avif',
      alt: 'CT45 Computer Link on a desktop: a scanning session with three barcodes and Excel export',
    },
    code: 'HA 009',
    name: 'CT45 Computer Link',
    destination: 'BARCODE SCANNING',
    category: 'Desktop + Android',
    gate: 'C02',
    status: 'OPEN SOURCE',
    open: true,
    summary: 'Scan on the handheld. Land on your computer.',
    story:
      'Sends each barcode scanned on a Honeywell CT45 to a Mac or Windows computer over an encrypted local connection, into a searchable log you can export to Excel.',
    stack: ['Electron', 'Kotlin', 'TLS'],
    url: 'https://github.com/hnkabraham/CT45-Computer-Link',
    linkLabel: 'Explore repository',
    image: {
      src: '/images/ct45-handheld.jpg',
      width: 690,
      height: 1457,
      alt: 'The CT45 app connected to a computer, with three scans in its history marked Sent',
      caption: 'ON THE HANDHELD',
    },
    features: [
      'Pair once by scanning the computer’s QR code',
      'Scans made offline wait on the handheld and resend',
      'Named sessions, Excel export, or typing into any app',
    ],
  },
  {
    id: 'spoolbrush',
    code: 'HA 004',
    name: 'SpoolBrush',
    destination: '3D PRINTING',
    category: 'Creative tools',
    gate: 'B02',
    status: 'IN THE HANGAR',
    open: false,
    summary: 'Paint a mesh. Print it in color.',
    story:
      'A local workbench for painting 3D meshes with your filament colors and exporting printable 3MF files.',
    stack: ['Python', 'Three.js', '3MF'],
    features: [
      'Crease-aware mesh regions and filament palettes',
      'A visual workbench, CLI, and MCP server',
      'Early alpha; public release is planned',
    ],
  },
  {
    id: 'spatialscanner',
    code: 'HA 005',
    name: 'SpatialScanner',
    destination: 'SPATIAL COMPUTING',
    category: 'Capture & reconstruct',
    gate: 'C01',
    status: 'IN DEVELOPMENT',
    open: false,
    summary: 'Capture the world in 3D.',
    story:
      'An iPhone 3D capture experiment using ARKit, TrueDepth, Object Capture, and RoomPlan.',
    stack: ['Flutter', 'ARKit', 'Metal'],
    features: [
      'Native capture and local reconstruction',
      'A library for reviewing, sharing, and exporting models',
      'In development; device testing in progress',
    ],
  },
];
/**
 * The two projects anyone can open right now, shown side by side with a
 * screenshot each. The ids match the board's and the scheduled probe's, so a
 * card carries the same reachability check the briefing does. The captures
 * are framed to leave out each site's live chrome — a flight count is
 * plausible on any day, but a "data through" date would age the page.
 */
export const liveSites = [
  {
    id: 'flight-tracker',
    name: 'United Flight Tracker',
    host: 'unitedflighttracker.com',
    url: 'https://unitedflighttracker.com',
    detail:
      'Every United and United Express aircraft in the air, on a 3D globe, with fleet, schedule and on-time views behind it. An independent project.',
    image: '/images/live-united-flight-tracker',
    alt: 'United Flight Tracker: hundreds of aircraft over North America on a 3D globe, beside a list of active flights',
  },
  {
    id: 'routeloads',
    name: 'routeloads',
    host: 'routeloads.com',
    url: 'https://routeloads.com',
    detail:
      'How full every US route runs, from the DOT’s monthly filings: seat occupancy, fares and on-time rates across 70,000+ route pairs.',
    image: '/images/live-routeloads',
    alt: 'routeloads: the question “How full are flight routes in America?” beside a ranked list of the emptiest routes',
  },
];
export const openSource = [
  {
    name: 'Personal Airspace',
    repo: 'henokabraham.com',
    detail: 'This site: a 787 tour in Three.js and GLSL.',
    stack: 'TYPESCRIPT / WEBGL',
  },
  {
    name: 'iPhone ↔ Wear OS',
    repo: 'wear-ios-bridge',
    detail: 'An encrypted bridge across two device ecosystems.',
    stack: 'SWIFT / KOTLIN',
  },
  {
    name: 'OBDEngine',
    repo: 'swift-obd-engine',
    detail: 'Vehicle diagnostics and simulation for Swift.',
    stack: 'SWIFT',
  },
  {
    name: 'CT45 Computer Link',
    repo: 'CT45-Computer-Link',
    detail: 'Barcode scans from a handheld to your desktop.',
    stack: 'ELECTRON / KOTLIN',
  },
  {
    name: 'Mobile Mode',
    repo: 'claude-code-mobile-mode',
    detail: 'Run Claude Code from your phone.',
    stack: 'DEVELOPER TOOLS',
  },
];
