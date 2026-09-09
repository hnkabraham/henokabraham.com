/**
 * Hidden extras in the departure: a wing wave when the aircraft is
 * clicked, an aileron roll for the Konami code or the word "roll", a GT350
 * chase car on the runway for "gt350" or "shelby", and Karl the Fog through
 * the Golden Gate for "karl". Typed words are only read outside form
 * fields and without modifier keys, so nothing else on the page changes.
 */
export type EasterEgg = 'wave' | 'roll' | 'chase' | 'fog';
/** Stunts need the wheels up: progress from which they are flown. */
export const AIRBORNE_PROGRESS = 0.56;

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];
const WORDS: [string, EasterEgg][] = [
  ['roll', 'roll'],
  ['wave', 'wave'],
  ['gt350', 'chase'],
  ['shelby', 'chase'],
  ['karl', 'fog'],
  ['fog', 'fog'],
];

/** Which egg, if any, a key sequence has just completed. */
export function createKeyWatcher() {
  let keys: string[] = [];
  let typed = '';
  return (key: string): EasterEgg | null => {
    keys = [...keys, key].slice(-KONAMI.length);
    if (keys.length === KONAMI.length && keys.every((k, i) => k.toLowerCase() === KONAMI[i].toLowerCase())) {
      keys = [];
      typed = '';
      return 'roll';
    }
    if (/^[a-z0-9]$/i.test(key)) {
      typed = (typed + key.toLowerCase()).slice(-8);
      for (const [word, egg] of WORDS)
        if (typed.endsWith(word)) {
          typed = '';
          return egg;
        }
    }
    return null;
  };
}

/** One click waves; three quick clicks on the aircraft roll it. */
export function createClickWatcher(window = 650) {
  let times: number[] = [];
  return (now: number): EasterEgg => {
    times = [...times.filter((t) => now - t < window), now];
    if (times.length >= 3) {
      times = [];
      return 'roll';
    }
    return 'wave';
  };
}

const typingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  return (
    /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) ||
    element.isContentEditable
  );
};

/**
 * Wires keyboard and click detection; `hitsAircraft` decides whether a
 * click at the given client position lands on the aircraft. Returns the
 * function that removes the listeners.
 */
export function watchEasterEggs(
  canvas: HTMLElement,
  hitsAircraft: (x: number, y: number) => boolean,
  onEgg: (egg: EasterEgg) => void,
) {
  const keys = createKeyWatcher();
  const clicks = createClickWatcher();
  const onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typingTarget(event.target)) return;
    const egg = keys(event.key);
    if (egg) onEgg(egg);
  };
  const onClick = (event: MouseEvent) => {
    if (!hitsAircraft(event.clientX, event.clientY)) return;
    onEgg(clicks(performance.now()));
  };
  addEventListener('keydown', onKey);
  canvas.addEventListener('click', onClick);
  return () => {
    removeEventListener('keydown', onKey);
    canvas.removeEventListener('click', onClick);
  };
}

/** Toast copy shown by the page when an egg is found. */
export const EGG_MESSAGES: Record<EasterEgg | 'grounded', (on: boolean) => string> = {
  grounded: () => 'Not on the ground. Scroll on and try that once the gear is up.',
  wave: () => 'Wing wave. Hello down there.',
  roll: () => 'Aileron roll. Tex Johnston, 1955: “just selling airplanes.”',
  chase: (on) =>
    on ? 'GT350 chase car on the runway. Type gt350 again to park it.' : 'GT350 parked.',
  fog: (on) =>
    on ? 'Karl the Fog is rolling in through the Gate. Type karl again to clear it.' : 'Karl has left the Gate.',
};
