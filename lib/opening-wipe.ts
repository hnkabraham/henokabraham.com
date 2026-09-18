export type OpeningWipe = {
  attach: (story: HTMLElement | null) => void;
  update: (
    front: Float32Array,
    width: number,
    height: number,
    opening?: string,
  ) => void;
  dispose: () => void;
};

/** Apply the wing envelope to real text, preserving its fonts and selection. */
export function createOpeningWipe(): OpeningWipe {
  let story: HTMLElement | null = null;
  let parts: {
    node: HTMLElement;
    left: number;
    top: number;
    clip: string;
  }[] = [];
  let dirty = true;
  let width = 0,
    height = 0;
  let openingState: string | undefined;
  let last: Float32Array | null = null;
  let applied: Float32Array | null = null;
  const observer = new ResizeObserver(() => {
    dirty = true;
  });
  const update = (
    front: Float32Array,
    w: number,
    h: number,
    opening?: string,
  ) => {
    last = front;
    if (!story) return;
    if (w !== width || h !== height || opening !== openingState) dirty = true;
    openingState = opening;
    width = w;
    height = h;
    if (!dirty && applied && front.every((y, i) => y === applied![i])) return;
    applied = front.slice();
    if (dirty) {
      // Read all geometry together; clip-path changes paint, never layout.
      const frame = (story.offsetParent ?? story).getBoundingClientRect();
      parts = Array.from(story.children, (child) => {
        const node = child as HTMLElement;
        const box = node.getBoundingClientRect();
        return {
          node,
          left: box.left - frame.left,
          top: box.top - frame.top,
          clip: '',
        };
      });
      dirty = false;
    }
    for (const part of parts) {
      const edge = Array.from(
        front,
        (y, i) =>
          `${((i / (front.length - 1)) * w - part.left).toFixed(1)}px ${(y * h - part.top).toFixed(1)}px`,
      );
      const clip = `polygon(${edge.join(',')},${(w - part.left).toFixed(1)}px ${h}px,${(-part.left).toFixed(1)}px ${h}px)`;
      if (clip !== part.clip) {
        part.node.style.clipPath = clip;
        part.clip = clip;
      }
    }
  };
  const attach = (next: HTMLElement | null) => {
    observer.disconnect();
    for (const { node } of parts) node.style.removeProperty('clip-path');
    parts = [];
    story = next;
    dirty = true;
    if (story) {
      observer.observe(story);
      // On reverse scrolling the remounted title starts at its current cut,
      // without a frame of fully visible text flashing over the aircraft.
      if (last && width && height) update(last, width, height, openingState);
    }
  };
  return { attach, update, dispose: () => attach(null) };
}
