/** Where the visitor's Simple view choice is kept. */
export const VIEW_KEY = 'personal-airspace:view';

/**
 * Simple view or the full journey, decided before the first paint. It runs
 * inline at the top of the body (app/layout.tsx) and marks the page with the
 * same answer `useViewPreference` reaches after hydration: a saved choice,
 * else reduced motion, a data saver or a 2G connection. The server sends
 * the full journey's markup to everyone, so the stylesheets lay the page out
 * from this mark instead; nobody sees the other layout first, and a link to a
 * section lands where the section will stay. Keep the two in step;
 * scripts/check-view-preference.mjs runs both on the same visitors.
 */
export const VIEW_SCRIPT = `(()=>{let s;try{const v=localStorage.getItem(${JSON.stringify(VIEW_KEY)});if(v==='simple'||v==='full')s=v==='simple'}catch{}if(s===undefined){const n=navigator.connection;s=matchMedia('(prefers-reduced-motion: reduce)').matches||!!(n&&n.saveData)||/^(slow-)?2g$/.test((n&&n.effectiveType)||'')}document.documentElement.dataset.simpleView=String(s)})()`;
