/**
 * A signal that aborts when `signal` does or after `ms` milliseconds,
 * whichever comes first. AbortSignal.any arrived in Safari 17.4; on an older
 * Safari calling it throws, which failed the very request it was guarding
 * (the 787 and the car never loaded there), so the same is done by hand.
 */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  const timeout =
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ms)
      : (() => {
          const clock = new AbortController();
          setTimeout(
            () =>
              clock.abort(
                new DOMException('The operation timed out.', 'TimeoutError'),
              ),
            ms,
          );
          return clock.signal;
        })();
  if (typeof AbortSignal.any === 'function')
    return AbortSignal.any([signal, timeout]);
  const either = new AbortController();
  for (const source of [signal, timeout]) {
    if (source.aborted) {
      either.abort(source.reason);
      break;
    }
    source.addEventListener('abort', () => either.abort(source.reason), {
      once: true,
    });
  }
  return either.signal;
}
