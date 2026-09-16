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
  features: string[];
};
export const flights: Flight[] = [
  {
    id: 'bay-departure',
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
    features: [
      '4K textures and modeled fan blades',
      'Engine, wing, and tail close-ups',
      'Daylight reflections and custom livery',
      'Adaptive graphics and reduced-motion support',
    ],
  },
  {
    id: 'flight-tracker',
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
    id: 'downshift',
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
export const openSource = [
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
    name: 'Mobile Mode',
    repo: 'claude-code-mobile-mode',
    detail: 'Run Claude Code from your phone.',
    stack: 'DEVELOPER TOOLS',
  },
];
