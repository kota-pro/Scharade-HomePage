import type { TextMeasure } from '../lib/exhibitionText.ts';

/** Only successful measurements are cached. A failed or stalled attempt can be retried. */
export function createTextMeasurement(load: () => Promise<TextMeasure>, timeoutMs = 5000, onFailure?: (error: unknown) => void) {
  let measure: TextMeasure | undefined, pending: Promise<void> | undefined, failed = false;
  return {
    get: () => measure,
    unavailable: () => failed && !measure,
    load(): Promise<void> {
      if (measure) return Promise.resolve();
      if (pending) return pending;
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Text measurement timed out')), timeoutMs); });
      const attempt = Promise.race([Promise.resolve().then(load), timeout])
        .then(result => { measure = result; failed = false; })
        .catch(error => { failed = true; try { onFailure?.(error); } catch {} throw error; })
        .finally(() => { clearTimeout(timer); if (pending === attempt) pending = undefined; });
      pending = attempt;
      return attempt;
    },
  };
}
