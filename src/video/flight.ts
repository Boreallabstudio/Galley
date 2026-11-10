/**
 * Shared pieces of the Ascent skin: the flight-path geometry, the "lift" that raises and lowers the HUD, and small
 * formatting helpers. The custom elements in ascent.ts all draw from these, so the path, the events along it and the
 * time slider's thumb always agree on where a moment in the film sits.
 */

/** How quickly the path climbs before it flattens out. */
const K = 3.4;
const DEN = 1 - Math.exp(-K);

export interface Geometry {
  x0: number;
  x1: number;
  y0: number;
  rise: number;
}

/**
 * The path for a skin `width` by `height` pixels. `lift` 1 is the raised path with the HUD showing; `lift` 0 is a flat
 * line on the bottom edge, which the skin fades out entirely while the film plays.
 */
export function geometry(width: number, height: number, lift: number): Geometry {
  const small = width < 760;
  const x0 = width * 0.043 * lift;
  const x1 = width - width * 0.043 * lift;
  if (small) return { x0, x1, y0: height - 3 - (height * 0.08 + 50) * lift, rise: height * 0.15 * lift };
  return { x0, x1, y0: height - 3 - height * 0.15 * lift, rise: height * 0.235 * lift };
}

export const pathX = (g: Geometry, t: number) => g.x0 + (g.x1 - g.x0) * t;
export const pathY = (g: Geometry, t: number) => g.y0 - (g.rise * (1 - Math.exp(-K * t))) / DEN;

/** SVG path data for the stretch of the path from `a` to `b` (both 0–1 of the film). */
export function pathData(g: Geometry, a: number, b: number): string {
  const steps = Math.max(2, Math.round(80 * (b - a)) + 2);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = a + ((b - a) * i) / steps;
    d += `${i ? 'L' : 'M'}${pathX(g, t).toFixed(1)} ${pathY(g, t).toFixed(1)}`;
  }
  return d;
}

/** Mission-clock time: minutes and seconds, both two digits. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Time in words, for accessible names. */
export function spoken(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m ? `${m} ${m === 1 ? 'minute' : 'minutes'} ` : ''}${r} ${r === 1 ? 'second' : 'seconds'}`;
}

/** Playback rate as the skin writes it: 1.0×, 1.25×, 0.5×. */
export function rateText(rate: number): string {
  return `${rate.toFixed((rate * 4) % 2 ? 2 : 1)}×`;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One Lift per player. `<ascent-lift>` owns the value and moves it towards 1 (HUD up) or 0 (HUD away);
 * the drawing elements subscribe and redraw on every step.
 */
export class Lift {
  value = 1;
  idle = false;
  /** Bring the HUD back and restart the idle timer. `<ascent-lift>` replaces this when it connects. */
  wake: () => void = () => {};
  #listeners = new Set<(value: number) => void>();

  set(value: number) {
    this.value = value;
    for (const listener of this.#listeners) listener(value);
  }

  subscribe(listener: (value: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

const lifts = new WeakMap<Element, Lift>();

export function skinRoot(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('media-container');
}

export function liftFor(element: Element): Lift | null {
  const root = skinRoot(element);
  if (!root) return null;
  let lift = lifts.get(root);
  if (!lift) {
    lift = new Lift();
    lifts.set(root, lift);
  }
  return lift;
}

/**
 * Where the playhead is drawn, 0–1. While the time slider is dragged it follows the pointer; otherwise it follows the
 * slider's fill, which already holds a pending seek target, so the craft never jumps back while a seek completes.
 */
export function progress(slider: HTMLElement | null, currentTime: number, duration: number): number {
  if (slider) {
    const name = slider.hasAttribute('data-dragging') ? '--media-slider-pointer' : '--media-slider-fill';
    const percent = parseFloat(slider.style.getPropertyValue(name));
    if (Number.isFinite(percent)) return Math.min(1, Math.max(0, percent / 100));
  }
  return duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
}

/** The media element inside a player: a `<video>`, or a custom media element that speaks its API. */
export function findMedia(root: Element): HTMLMediaElement | null {
  for (const element of root.querySelectorAll('*')) {
    if (element.localName.startsWith('media-') || element.localName.startsWith('ascent-')) continue;
    if ('currentTime' in element && 'textTracks' in element && 'paused' in element) return element as HTMLMediaElement;
  }
  return null;
}
