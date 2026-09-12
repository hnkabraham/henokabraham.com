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
  image?: string;
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
    summary: 'A Dreamliner, an open sky, and a closer look at the details.',
    story:
      'An airborne 787 flies into the moving sky, then a scroll-driven camera travels past its engine, wing and tail. An open-source FlightGear exterior is converted into a compact browser model, lit with HDR daylight and given a personal livery. The original Bay terrain experiment remains in the repository; this new scene puts the rendering budget into the aircraft.',
    stack: ['TypeScript', 'Three.js', 'GLSL', 'Python'],
    url: '?project=bay-departure&chapter=preflight',
    linkLabel: 'Return to the open sky',
    features: [
      'A detailed exterior with a 4K engine texture, modeled fan blades and separate flight surfaces, batched into ten main draw calls.',
      'A continuous scroll tour with engine, wing and tail close-ups, composed separately for wide and portrait screens.',
      'HDR reflections, self-shadowing, a personal navy-and-orange livery, turning fans and subtle wing flex.',
      'Adaptive render resolution, an idle sky opening, off-screen suspension and a static reduced-motion view.',
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
    summary: 'An airline network. A whole new perspective.',
    story:
      'An independent window into United and United Express operations. Explore aircraft on a 3D globe, follow individual flights, and get a closer look at the fleet and the airports that connect it.',
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
    id: 'downshift',
    code: 'HA 002',
    name: 'Downshift',
    destination: 'AUTOMOTIVE',
    category: 'Native iOS',
    gate: 'A02',
    status: 'IN THE HANGAR',
    open: false,
    summary: 'A better connection between driver and machine.',
    story:
      'An iOS driving companion that turns live OBD-II data into shift coaching, diagnostics, and performance telemetry. A built-in simulator lets you explore the complete driving experience without connecting a car.',
    stack: ['SwiftUI', 'OBD-II', 'CoreBluetooth'],
    image: '/images/downshift-dashboard.jpg',
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
    summary: 'Different ecosystems. One conversation.',
    story:
      'An encrypted Bluetooth bridge that keeps an already-configured Wear OS watch useful with an iPhone. It connects notifications, health, contacts, call state, and Apple Music. Initial watch setup still requires its supported Android setup flow.',
    stack: ['Swift', 'Kotlin', 'Bluetooth LE'],
    url: 'https://github.com/hnkabraham/wear-ios-bridge',
    linkLabel: 'Explore repository',
    features: [
      'Encrypted device-to-device communication',
      'iPhone notifications and health synchronization',
      'A core beta; physical-device validation remains required',
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
    summary: 'From a bare mesh to something you can hold.',
    story:
      'A local-first workbench for turning triangle meshes into filament-assigned 3MF files. Inspect geometry, divide it into stable surface regions, and assign colors from the spools you actually own.',
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
    summary: 'Bring a little of the real world into the digital one.',
    story:
      'A mobile exploration of 3D capture and reconstruction, combining a Flutter product shell with native iPhone capture. The project brings together ARKit, TrueDepth, Object Capture, RoomPlan, and local model exports.',
    stack: ['Flutter', 'ARKit', 'Metal'],
    features: [
      'Native capture and local reconstruction',
      'A library for reviewing, sharing, and exporting models',
      'In development; sensor workflows require device validation',
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
    detail:
      'Vehicle communication, diagnostics, and simulation in a Swift package.',
    stack: 'SWIFT',
  },
  {
    name: 'Mobile Mode',
    repo: 'claude-code-mobile-mode',
    detail:
      'Tappable options and push notifications for phone-driven Claude Code sessions.',
    stack: 'DEVELOPER TOOLS',
  },
];
