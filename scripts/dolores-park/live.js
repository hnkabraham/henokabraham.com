// The standalone reference page for the live viewer (lib/dolores-park-viewer.js,
// the same module the site's Garage section runs). URL parameters:
// phone=1, sun=live|evening|winter|summer (live by default: the real sky
// over the park), time=<ISO date or ms> for a live sky at that moment
// rather than now, pose=x,y,h,lookx,looky,lookh, fov (horizontal), w, h,
// dpr, scrollFriendly=1, benchmark=1, shot=1. It sets window.doloresViewer, window.liveInfo,
// window.png (shot=1), window.error and window.done for render.mjs and
// verify-live.mjs.
import { createDoloresViewer } from '../../lib/dolores-park-viewer.js';

const q = new URLSearchParams(location.search);
const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
const hint = document.querySelector('#hint');
const options = {
  phone: q.get('phone') === '1',
  scrollFriendly: q.get('scrollFriendly') === '1',
  sun: q.get('sun') || (q.get('preset') === 'victorians' ? 'summer' : 'live'),
  // The standalone server serves the repository root, not public/.
  load: async (path) => {
    const response = await fetch('/public' + path);
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  },
  dracoPath: '/public/draco/',
  preserveDrawingBuffer: q.get('shot') === '1',
  onContextLost: () => {
    hint.textContent = 'Graphics paused — reload to restore';
  },
  onContextRestored: () => {
    window.doloresViewer.dispose();
    void start();
  },
};
if (q.has('time'))
  options.time = /^\d+$/.test(q.get('time'))
    ? Number(q.get('time'))
    : Date.parse(q.get('time'));
if (q.has('dpr')) options.pixelRatio = num('dpr');
if (q.has('fov')) options.fov = num('fov');
if (q.has('pose')) options.pose = q.get('pose').split(',').map(Number);
if (q.has('w') || q.has('h'))
  options.size = [num('w') ?? innerWidth, num('h') ?? innerHeight];

async function start() {
  window.done = false;
  try {
    const viewer = await createDoloresViewer(document.body, options);
    window.doloresViewer = viewer;
    window.liveInfo = viewer.info;
    if (q.get('benchmark') === '1') await viewer.benchmark();
    if (q.get('shot') === '1') window.png = viewer.snapshot();
    hint.textContent = 'Drag to look around';
  } catch (e) {
    window.error = e.stack || String(e);
    hint.textContent = 'Could not load Dolores Park';
    console.error(e);
  }
  window.done = true;
}
void start();
