import {
  PlayerController,
  playerContext,
  selectBuffer,
  selectError,
  selectPlayback,
  selectPlaybackRate,
  selectTextTrack,
  selectTime,
  selectVolume,
  type PropertyValues,
  UIElement,
} from '@videojs/html';

import {
  clock,
  findMedia,
  geometry,
  heat,
  type Lift,
  liftFor,
  pathData,
  pathX,
  pathY,
  progress,
  rateText,
  reducedMotion,
  skinRoot,
  spoken,
} from './flight';

const SVG = 'http://www.w3.org/2000/svg';
let uid = 0;
/** A document-unique id, so two players on one page do not share SVG filters. */
const nextId = (prefix: string) => `${prefix}-${++uid}`;
const INK = '#f4f1ea';
const BURN = '#ff5b1f';

interface Chapter {
  startTime: number;
  endTime: number;
  text: string;
}

/** Index of the chapter playing at `time`: the last one that has started. */
function chapterAt(chapters: readonly Chapter[], time: number): number {
  let index = 0;
  chapters.forEach((chapter, i) => {
    if (time >= chapter.startTime - 0.05) index = i;
  });
  return index;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Base for the elements that draw on the path: tracks the skin's size and the lift, and coalesces redraws into one
 * per animation frame.
 */
abstract class PathElement extends UIElement {
  protected time = new PlayerController(this, playerContext, selectTime);
  protected tracks = new PlayerController(this, playerContext, selectTextTrack);

  protected root: HTMLElement | null = null;
  protected slider: HTMLElement | null = null;
  protected lift: Lift | null = null;
  protected width = 0;
  protected height = 0;
  #frame = 0;
  #abort: AbortController | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.#abort?.abort();
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    this.root = skinRoot(this);
    this.lift = liftFor(this);
    if (!this.root || !this.lift) return;
    this.slider = this.root.querySelector<HTMLElement>('media-time-slider');

    const root = this.root;
    const resize = new ResizeObserver(() => {
      this.width = root.clientWidth;
      this.height = root.clientHeight;
      this.schedule();
    });
    resize.observe(root);
    const unsubscribe = this.lift.subscribe(() => this.schedule());
    // The time slider writes its fill and pointer as CSS variables on itself; follow them for a smooth drag.
    const watch = new MutationObserver(() => this.schedule());
    if (this.slider) watch.observe(this.slider, { attributes: true, attributeFilter: ['style', 'data-dragging'] });
    signal.addEventListener('abort', () => {
      resize.disconnect();
      watch.disconnect();
      unsubscribe();
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    this.schedule();
  }

  protected schedule() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (this.width && this.height) this.draw();
    });
  }

  protected get chapters(): readonly Chapter[] {
    return this.tracks.value?.chaptersCues ?? [];
  }

  protected get duration(): number {
    const duration = this.time.value?.duration ?? 0;
    if (Number.isFinite(duration) && duration > 0) return duration;
    const chapters = this.chapters;
    return chapters.length ? chapters[chapters.length - 1].endTime : 0;
  }

  protected abstract draw(): void;
}

/** The gas that vents from the craft during a hold: forty puffs, left and right, on a fixed pseudo-random spread. */
function ventPuffs(): string {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let puffs = '';
  for (let i = 0; i < 40; i++) {
    const side = i % 2 ? 1 : -1;
    const dx = side * (60 + random() * 110);
    const dy = -(19 + random() * 54);
    const scale = 2.4 + random() * 2;
    puffs += `<circle class="asc-vp" cx="${side * 9}" cy="11" r="5" style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--s:${scale.toFixed(1)};--d:${(-i * 0.065).toFixed(2)}s"/>`;
  }
  return puffs;
}

/**
 * <ascent-flight>: the flight path. A dotted course still to fly, the buffered stretch ahead, the flown part in orange
 * with a glow, a dot for each chapter and the craft at the playhead. The craft's engine glow is an ember when paused
 * and grows with the playback rate; during a hold (`data-hold` on the skin) the craft vents gas. Purely visual
 * (`aria-hidden`); the `<media-time-slider>` underneath it carries the interaction, and its thumb is moved onto the
 * craft here.
 */
class AscentFlightElement extends PathElement {
  #buffer = new PlayerController(this, playerContext, selectBuffer);
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #rate = new PlayerController(this, playerContext, selectPlaybackRate);
  #burn!: SVGCircleElement;
  #svg!: SVGSVGElement;
  #rest!: SVGPathElement;
  #under!: SVGPathElement;
  #buffered!: SVGPathElement;
  #glow!: SVGPathElement;
  #done!: SVGPathElement;
  #dots!: SVGGElement;
  #craft!: SVGGElement;
  #arrow!: SVGPathElement;

  connectedCallback() {
    if (!this.#svg) this.#build();
    super.connectedCallback();
  }

  #build() {
    this.setAttribute('aria-hidden', 'true');
    const glow = nextId('asc-glow');
    const vapour = nextId('asc-vapour');
    this.innerHTML = `<svg xmlns="${SVG}">
<defs><filter id="${glow}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="${vapour}" filterUnits="userSpaceOnUse" x="-220" y="-170" width="440" height="260"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="3" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="3.4"/></filter></defs>
<path class="under" fill="none" stroke="rgba(3,5,9,.32)" stroke-width="5" stroke-linecap="round"/>
<path class="rest" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 9" opacity=".55"/>
<path class="buf" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".5"/>
<path class="glow" fill="none" stroke="${BURN}" stroke-width="10" opacity=".45" filter="url(#${glow})"/>
<path class="done" fill="none" stroke="${BURN}" stroke-width="4" stroke-linecap="round"/>
<g class="dots"></g>
<g class="craft"><g class="asc-vent" filter="url(#${vapour})">${ventPuffs()}</g><circle class="craft-glow" r="26" fill="${BURN}" opacity=".5" filter="url(#${glow})"/><circle class="craft-ring" r="17" fill="rgba(3,5,9,.35)" stroke="${INK}" stroke-width="1.5"/><path class="arrow" d="M15 0L-8 -8L-3 0L-8 8Z" fill="${INK}"/></g>
</svg>`;
    const q = <T extends Element>(selector: string) => this.querySelector(selector) as T;
    this.#svg = q('svg');
    this.#rest = q('.rest');
    this.#under = q('.under');
    this.#buffered = q('.buf');
    this.#glow = q('.glow');
    this.#done = q('.done');
    this.#dots = q('.dots');
    this.#craft = q('.craft');
    this.#arrow = q('.arrow');
    this.#burn = q('.craft-glow');
  }

  protected draw() {
    const { width: W, height: H } = this;
    const lift = this.lift?.value ?? 1;
    const g = geometry(W, H, lift);
    const time = this.time.value;
    const duration = this.duration;
    const currentTime = time?.currentTime ?? 0;
    const t = progress(this.slider, currentTime, duration);

    this.#svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const rest = pathData(g, t, 1);
    this.#rest.setAttribute('d', rest);
    this.#under.setAttribute('d', rest);
    this.#rest.setAttribute('opacity', String(0.3 + 0.25 * lift));
    const done = pathData(g, 0, t);
    this.#done.setAttribute('d', done);
    this.#glow.setAttribute('d', done);

    // Buffered: the stretch of the range that holds the playhead.
    let ahead = t;
    if (duration > 0) {
      for (const [start, end] of this.#buffer.value?.buffered ?? []) {
        if (start <= currentTime + 0.5 && end > currentTime) ahead = Math.min(1, end / duration);
      }
    }
    this.#buffered.setAttribute('d', pathData(g, t, Math.max(t, ahead)));

    const angle =
      (Math.atan2(
        pathY(g, Math.min(1, t + 0.004)) - pathY(g, Math.max(0, t - 0.004)),
        pathX(g, Math.min(1, t + 0.004)) - pathX(g, Math.max(0, t - 0.004))
      ) *
        180) /
      Math.PI;
    // Drawn sizes follow the player: smaller under 1100 px, larger on very big screens.
    const size = Math.max(0.62, Math.min(1, W / 1100)) * Math.min(1.45, Math.max(1, W / 1600));
    const big = Math.max(1, size);
    this.#done.setAttribute('stroke-width', (4 * big).toFixed(2));
    this.#glow.setAttribute('stroke-width', (10 * big).toFixed(2));
    this.#rest.setAttribute('stroke-width', (2 * big).toFixed(2));
    this.#buffered.setAttribute('stroke-width', (2 * big).toFixed(2));
    this.#under.setAttribute('stroke-width', (5 * big).toFixed(2));
    const scale = size * (0.35 + 0.65 * lift);
    const cx = pathX(g, t);
    const cy = pathY(g, t);
    this.#craft.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${scale.toFixed(3)})`);
    this.#arrow.setAttribute('transform', `rotate(${angle.toFixed(1)})`);

    // Engine glow: an ember when paused, brighter and wider with speed.
    const burning = this.#playback.value ? !this.#playback.value.paused : false;
    this.#burn.setAttribute('r', String(burning ? 18 + 8 * (this.#rate.value?.playbackRate ?? 1) : 17));
    this.#burn.setAttribute('opacity', burning ? '.55' : '.3');

    // One dot per chapter.
    const chapters = duration > 0 ? this.chapters : [];
    while (this.#dots.children.length > chapters.length) this.#dots.lastChild!.remove();
    while (this.#dots.children.length < chapters.length) {
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('stroke-width', '2');
      this.#dots.append(dot);
    }
    chapters.forEach((chapter, i) => {
      const f = Math.min(1, chapter.startTime / duration);
      const past = f <= t + 1e-4;
      const dot = this.#dots.children[i];
      dot.setAttribute('cx', pathX(g, f).toFixed(1));
      dot.setAttribute('cy', pathY(g, f).toFixed(1));
      dot.setAttribute('r', (6 * Math.max(0.7, size)).toFixed(2));
      dot.setAttribute('fill', past ? BURN : '#070a0f');
      dot.setAttribute('stroke', past ? BURN : INK);
      dot.setAttribute('opacity', String(lift * (past ? 1 : 0.7)));
    });

    // The slider's thumb (the focusable role="slider") sits on the craft, so focus and touch land where the eye is.
    const thumb = this.slider?.querySelector<HTMLElement>('media-slider-thumb');
    if (thumb && this.slider) {
      thumb.style.left = `${(cx - this.slider.offsetLeft).toFixed(1)}px`;
      thumb.style.top = `${(cy - this.slider.offsetTop).toFixed(1)}px`;
    }
  }
}

/**
 * <ascent-events>: the film's chapters as events along the path, read from the media's chapters text track.
 * Each is a button that flies the craft there. Without a chapters track it renders nothing.
 */
class AscentEventsElement extends PathElement {
  #buttons: HTMLButtonElement[] = [];
  #signature = '';

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', this.#onClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#onClick);
  }

  #onClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-start]');
    if (!button) return;
    void this.time.value?.seek(Number(button.dataset.start) + 0.01);
    this.lift?.wake();
  };

  #render(chapters: readonly Chapter[]) {
    this.replaceChildren();
    this.#buttons = chapters.map((chapter, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `asc-ev${i === 0 ? ' first' : ''}`;
      button.dataset.start = String(chapter.startTime);
      const name = document.createElement('b');
      name.className = 'lab';
      name.textContent = chapter.text;
      const mark = document.createElement('i');
      mark.className = 'num';
      mark.textContent = `${pad2(i + 1)} · ${clock(chapter.startTime)}`;
      button.append(name, mark);
      button.setAttribute('aria-label', `Jump to event ${i + 1}, ${chapter.text}, at ${spoken(chapter.startTime)}`);
      this.append(button);
      return button;
    });
  }

  protected draw() {
    const duration = this.duration;
    const chapters = duration > 0 ? this.chapters : [];
    const signature = chapters.map((c) => `${c.startTime}|${c.text}`).join('\n');
    if (signature !== this.#signature) {
      this.#signature = signature;
      this.#render(chapters);
    }
    if (!chapters.length) return;
    const g = geometry(this.width, this.height, this.lift?.value ?? 1);
    const currentTime = this.time.value?.currentTime ?? 0;
    const t = progress(this.slider, currentTime, duration);
    const current = chapterAt(chapters, currentTime);
    chapters.forEach((chapter, i) => {
      const f = Math.min(1, chapter.startTime / duration);
      const button = this.#buttons[i];
      button.style.left = `${pathX(g, f).toFixed(1)}px`;
      button.style.top = `${(pathY(g, f) - 8).toFixed(1)}px`;
      button.classList.toggle('past', f <= t + 1e-4);
      button.classList.toggle('cur', i === current);
    });
  }
}

/** <ascent-now>: top right, the event in progress ("Event 04 of 06", "The flame"). Hidden without chapters. */
class AscentNowElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #count?: HTMLElement;
  #name?: HTMLElement;

  connectedCallback() {
    super.connectedCallback();
    if (!this.#count) {
      this.#count = document.createElement('span');
      this.#count.className = 'lab';
      this.#name = document.createElement('b');
      this.#name.className = 'lab';
      this.append(this.#count, this.#name);
    }
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    const chapters = this.#tracks.value?.chaptersCues ?? [];
    this.hidden = !chapters.length;
    if (!chapters.length || !this.#count || !this.#name) return;
    const index = chapterAt(chapters, this.#time.value?.currentTime ?? 0);
    this.#count.textContent = `Event ${pad2(index + 1)} of ${pad2(chapters.length)}`;
    this.#name.textContent = chapters[index].text;
  }
}

/* ---------- engine dials ---------- */

interface DialDrawing {
  set(fraction: number, reading: string): void;
  /** The value a press at this point asks for, read from its angle around the dial. */
  fractionAt(event: PointerEvent): number;
}

/** The dial drawing (viewBox -2 -2 52 52, centre 24 24): a 270° ring that starts at the lower left. */
const DIAL_R = 21;
const DIAL_SEGMENTS = 30;
const DIAL_START = 135;
const DIAL_SWEEP = 270;
const HOT = '#fff6ec';

const dialPoint = (angle: number, radius: number) => {
  const a = (angle * Math.PI) / 180;
  return `${(24 + radius * Math.cos(a)).toFixed(1)} ${(24 + radius * Math.sin(a)).toFixed(1)}`;
};

/**
 * Draw an engine dial into `host`, with a readout beside it: the engine seen from behind. A glass body holds a dark
 * throat, and the glow in the throat grows from nothing, to a small ember, to white-hot at full. The ring around the
 * body lights up to the value in the same heat colours, and a tick on the body marks it.
 *
 * `stops` > 0 (speed) adds a small tick outside the ring for each stop.
 */
function drawDial(host: HTMLElement, stops: number): DialDrawing {
  const id = nextId('asc-dial');
  let segments = '';
  for (let i = 0; i < DIAL_SEGMENTS; i++) {
    const from = DIAL_START + (DIAL_SWEEP * i) / DIAL_SEGMENTS;
    const to = DIAL_START + DIAL_SWEEP * Math.min(1, (i + 1) / DIAL_SEGMENTS + 0.01);
    segments += `<path class="sg" d="M${dialPoint(from, DIAL_R)}A${DIAL_R} ${DIAL_R} 0 0 1 ${dialPoint(to, DIAL_R)}" stroke="${heat((i + 0.5) / DIAL_SEGMENTS)}"/>`;
  }
  let ticks = '';
  for (let i = 0; i < stops; i++) {
    const angle = DIAL_START + (DIAL_SWEEP * i) / (stops - 1);
    ticks += `<path d="M${dialPoint(angle, DIAL_R + 2.2)}L${dialPoint(angle, DIAL_R + 4.2)}" stroke="${INK}" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>`;
  }
  host.insertAdjacentHTML(
    'afterbegin',
    `<svg class="asc-thr-svg" viewBox="-2 -2 52 52" aria-hidden="true"><defs><filter id="${id}-bloom" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.6"/></filter><filter id="${id}-core" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.5"/></filter><linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK}" stop-opacity=".2"/><stop offset="1" stop-color="${INK}" stop-opacity=".05"/></linearGradient></defs><circle class="tg" cx="24" cy="24" r="12" filter="url(#${id}-bloom)"/><path d="M${dialPoint(DIAL_START, DIAL_R)}A${DIAL_R} ${DIAL_R} 0 1 1 ${dialPoint(DIAL_START + DIAL_SWEEP, DIAL_R)}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" opacity=".2"/><g fill="none" stroke-width="2.6" stroke-linecap="round">${segments}</g>${ticks}<circle cx="24" cy="24" r="16.5" fill="rgba(10,13,18,.82)"/><circle cx="24" cy="24" r="16.5" fill="url(#${id}-glass)" stroke="${INK}" stroke-opacity=".24"/><circle cx="24" cy="24" r="10.5" fill="rgba(2,3,5,.85)" stroke="${INK}" stroke-opacity=".28"/><circle class="to" cx="24" cy="24" filter="url(#${id}-core)"/><circle class="tc" cx="24" cy="24" fill="${HOT}"/><path class="tk" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/></svg><span class="asc-thr-read" aria-hidden="true"></span>`
  );
  const svg = host.querySelector('svg')!;
  const q = (selector: string) => svg.querySelector(selector)!;
  const reading = host.querySelector('.asc-thr-read')!;
  const lit = [...svg.querySelectorAll('.sg')];
  const bloom = q('.tg');
  const glow = q('.to');
  const core = q('.tc');
  const tick = q('.tk');
  return {
    set(fraction, text) {
      const f = Math.min(1, Math.max(0, fraction));
      const on = f > 0.004;
      lit.forEach((segment, i) => segment.setAttribute('opacity', on && (i + 0.5) / DIAL_SEGMENTS <= f + 1e-6 ? '1' : '0'));
      bloom.setAttribute('fill', heat(f * 0.85));
      bloom.setAttribute('r', (11 + 8 * f).toFixed(1));
      bloom.setAttribute('opacity', (on ? 0.2 + 0.7 * f : 0).toFixed(2));
      glow.setAttribute('r', (1.6 + 7.6 * f).toFixed(1));
      glow.setAttribute('fill', heat(f));
      glow.setAttribute('opacity', on ? '1' : '0');
      core.setAttribute('r', (0.6 + 4.6 * f * f).toFixed(1));
      core.setAttribute('opacity', (on ? 0.35 + 0.65 * f : 0).toFixed(2));
      const angle = DIAL_START + DIAL_SWEEP * f;
      tick.setAttribute('d', `M${dialPoint(angle, 12.4)}L${dialPoint(angle, 15.4)}`);
      reading.textContent = text;
    },
    fractionAt({ clientX, clientY }) {
      const rect = svg.getBoundingClientRect();
      const box = svg.viewBox.baseVal;
      const x = box.x + (clientX - rect.left) / (rect.width / box.width);
      const y = box.y + (clientY - rect.top) / (rect.height / box.height);
      let angle = (Math.atan2(y - 24, x - 24) * 180) / Math.PI;
      if (angle < DIAL_START - 45) angle += 360;
      // The open quarter at the bottom: its right half is full, its left half is zero.
      if (angle > DIAL_START + DIAL_SWEEP) return angle < DIAL_START + DIAL_SWEEP + 45 ? 1 : 0;
      return (angle - DIAL_START) / DIAL_SWEEP;
    },
  };
}

const DEFAULT_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * <ascent-engine kind="volume">: the volume dial. The `<media-volume-slider>` inside it is the accessible slider and
 * takes the keys; this element draws, and reads the pointer and the wheel.
 *
 * <ascent-engine kind="speed">: the speed dial. Video.js 10 has no playback-rate slider, so this element is the
 * slider itself (`role="slider"`), setting the rate through the player's playback-rate feature and snapping to the
 * player's rates.
 *
 * Both turn the same way: drag right or up for more, left or down for less; a press without a drag jumps to that
 * point on the ring; the wheel steps.
 *
 * `size="jet"` is the inline control on the console desk of wide players. `size="pop"` puts the same drawing on a
 * small glass plate that pops up above the mute key or the speed key in mid-size players. On touch, the first tap on
 * that key opens the pop-up and the second performs the key's action.
 */
class AscentEngineElement extends UIElement {
  static properties = { kind: { type: String }, size: { type: String } };
  kind = 'volume';
  size = 'jet';

  #volume = new PlayerController(this, playerContext, selectVolume);
  #rate = new PlayerController(this, playerContext, selectPlaybackRate);
  #drawing: DialDrawing | null = null;
  #abort: AbortController | null = null;

  get #speed() {
    return this.kind === 'speed';
  }

  connectedCallback() {
    super.connectedCallback();
    this.#abort?.abort();
    this.#abort = new AbortController();
    if (!this.#drawing) this.#drawing = drawDial(this, this.#speed ? DEFAULT_RATES.length : 0);
    this.#bindPointer(this.#abort.signal);
    if (this.#speed) this.#bindSpeed(this.#abort.signal);
    if (this.size === 'pop') this.#bindPopTouch(this.#abort.signal);
  }

  /**
   * Touch, mid-size players: the first tap on the button opens the pop-up; the next one acts. It closes after 3.5 s.
   * Escape closes it from the keyboard.
   */
  #bindPopTouch(signal: AbortSignal) {
    const wrap = this.closest<HTMLElement>('.asc-wrap');
    const button = wrap?.querySelector<HTMLElement>('.asc-b');
    const root = skinRoot(this);
    if (!wrap || !button || !root) return;
    let timer = 0;
    let skip = false;
    button.addEventListener(
      'pointerdown',
      (event) => {
        const width = root.clientWidth;
        if (event.pointerType !== 'touch' || width < 520 || width >= 900) return;
        if (!wrap.hasAttribute('data-open')) {
          wrap.setAttribute('data-open', '');
          skip = true;
        }
        clearTimeout(timer);
        timer = window.setTimeout(() => wrap.removeAttribute('data-open'), 3500);
      },
      { signal }
    );
    // Capture on the wrapper runs before the button's own click handling.
    wrap.addEventListener(
      'click',
      (event) => {
        if (!skip || !button.contains(event.target as Node)) return;
        skip = false;
        event.stopImmediatePropagation();
        event.preventDefault();
      },
      { signal, capture: true }
    );
    // Escape closes an open pop-up and returns focus to its button. It stays shut until focus or the pointer leaves
    // the wrapper, or the button's own keyboard focus would open it again at once.
    wrap.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !getComputedStyle(this).visibility.startsWith('visible')) return;
        wrap.setAttribute('data-shut', '');
        wrap.removeAttribute('data-open');
        button.focus();
        event.stopPropagation();
      },
      { signal }
    );
    wrap.addEventListener(
      'focusout',
      (event) => {
        if (!wrap.contains(event.relatedTarget as Node | null)) wrap.removeAttribute('data-shut');
      },
      { signal }
    );
    wrap.addEventListener('pointerleave', () => wrap.removeAttribute('data-shut'), { signal });
    signal.addEventListener('abort', () => clearTimeout(timer));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
  }

  get #rates(): readonly number[] {
    const rates = this.#rate.value?.playbackRates;
    return rates?.length ? [...rates].sort((a, b) => a - b) : DEFAULT_RATES;
  }

  #nearest(rate: number): number {
    return this.#rates.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a));
  }

  /** The rate last asked for, until the player reports it: quick key presses step from it, not from stale state. */
  #pending: number | null = null;
  #pendingTimer = 0;

  #setRate(rate: number) {
    this.#pending = this.#nearest(rate);
    this.#rate.value?.setPlaybackRate(this.#pending);
    clearTimeout(this.#pendingTimer);
    this.#pendingTimer = window.setTimeout(() => (this.#pending = null), 400);
  }

  #step(by: number) {
    const rates = this.#rates;
    const index = rates.indexOf(this.#nearest(this.#pending ?? this.#rate.value?.playbackRate ?? 1));
    this.#setRate(rates[Math.min(rates.length - 1, Math.max(0, index + by))]);
  }

  /** Where the dial stands, 0–1. */
  get #fraction(): number {
    if (this.#speed) return ((this.#pending ?? this.#rate.value?.playbackRate ?? 1) - 0.5) / 1.5;
    const volume = this.#volume.value;
    return volume ? (volume.muted ? 0 : volume.volume) : 1;
  }

  #setFraction(fraction: number) {
    const f = Math.min(1, Math.max(0, fraction));
    if (this.#speed) {
      this.#setRate(0.5 + 1.5 * f);
      return;
    }
    const volume = this.#volume.value;
    if (!volume) return;
    volume.setVolume(f);
    if (f > 0 && volume.muted) volume.setMuted(false);
  }

  /** Pointer and wheel, the same for both dials. */
  #bindPointer(signal: AbortSignal) {
    let down = false;
    let moved = false;
    let x0 = 0;
    let y0 = 0;
    let f0 = 0;
    this.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        down = true;
        moved = false;
        x0 = event.clientX;
        y0 = event.clientY;
        f0 = this.#fraction;
        this.setPointerCapture(event.pointerId);
        this.setAttribute('data-dragging', '');
      },
      { signal }
    );
    this.addEventListener(
      'pointermove',
      (event) => {
        if (!down) return;
        const travel = event.clientX - x0 - (event.clientY - y0);
        if (Math.abs(travel) > 3) moved = true;
        if (moved) this.#setFraction(f0 + travel / 120);
      },
      { signal }
    );
    this.addEventListener(
      'pointerup',
      (event) => {
        if (down && !moved) this.#setFraction(this.#drawing!.fractionAt(event));
        down = false;
        this.removeAttribute('data-dragging');
      },
      { signal }
    );
    this.addEventListener(
      'pointercancel',
      () => {
        down = false;
        this.removeAttribute('data-dragging');
      },
      { signal }
    );
    this.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const up = event.deltaY < 0;
        if (this.#speed) this.#step(up ? 1 : -1);
        else this.#setFraction(this.#fraction + (up ? 0.05 : -0.05));
      },
      { signal, passive: false }
    );
  }

  #bindSpeed(signal: AbortSignal) {
    this.setAttribute('role', 'slider');
    this.setAttribute('tabindex', '0');
    this.setAttribute('aria-label', 'Playback speed');
    this.setAttribute('aria-valuemin', '0.5');
    this.setAttribute('aria-valuemax', '2');

    this.addEventListener(
      'keydown',
      (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const rates = this.#rates;
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'PageUp') this.#step(1);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'PageDown') this.#step(-1);
        else if (event.key === 'Home') this.#setRate(rates[0]);
        else if (event.key === 'End') this.#setRate(rates[rates.length - 1]);
        else return;
        // Handled here, so the player's hotkeys (which skip prevented events) do not also seek or change volume.
        event.preventDefault();
      },
      { signal }
    );
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    if (!this.#drawing) return;
    if (this.#speed) {
      const rate = this.#rate.value?.playbackRate ?? 1;
      if (this.#pending === rate) this.#pending = null;
      const f = (rate - 0.5) / 1.5;
      this.#drawing.set(f, rateText(Math.min(2, Math.max(0.5, rate))));
      this.setAttribute('aria-valuenow', String(rate));
      this.setAttribute('aria-valuetext', `${rate} times`);
      this.hidden = this.#rate.value?.playbackRateAvailability === 'unsupported';
    } else {
      const volume = this.#volume.value;
      const f = volume ? (volume.muted ? 0 : volume.volume) : 1;
      this.#drawing.set(f, String(Math.round(f * 100)));
    }
  }
}

/** <ascent-rate>: the speed pill's text, 1.0× style. The `<media-playback-rate-button>` around it does the work. */
class AscentRateElement extends UIElement {
  #rate = new PlayerController(this, playerContext, selectPlaybackRate);

  protected update(changed: PropertyValues) {
    super.update(changed);
    this.textContent = rateText(this.#rate.value?.playbackRate ?? 1);
  }
}

/** <ascent-play-label>: the word on the play key. Launch before the film has started, Hold while it plays, Resume
 * when paused, Relaunch at the end. Decoration (`aria-hidden`): the `<media-play-button>` around it carries the name. */
class AscentPlayLabelElement extends UIElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #time = new PlayerController(this, playerContext, selectTime);

  protected update(changed: PropertyValues) {
    super.update(changed);
    const playback = this.#playback.value;
    const launched = (playback?.started ?? false) || (this.#time.value?.currentTime ?? 0) > 0.5;
    const text = playback?.ended ? 'Relaunch' : playback && !playback.paused ? 'Hold' : launched ? 'Resume' : 'Launch';
    if (this.textContent !== text) this.textContent = text;
  }
}

/**
 * <ascent-board>: the go / no-go board, top centre on wide players. Four lamps follow the film: Signal (Go, Hold
 * while it buffers, Lost on an error), Audio, Captions and Flight (Ready, Go, Hold, Complete). Decoration
 * (`aria-hidden`): each fact is already announced by the control or the status region that owns it.
 */
class AscentBoardElement extends UIElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #time = new PlayerController(this, playerContext, selectTime);
  #volume = new PlayerController(this, playerContext, selectVolume);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #error = new PlayerController(this, playerContext, selectError);
  #cells: Record<string, HTMLElement> = {};
  #watch: MutationObserver | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    if (!this.childElementCount) {
      for (const name of ['Signal', 'Audio', 'Captions', 'Flight']) {
        const cell = document.createElement('span');
        cell.className = 'asc-cell';
        cell.append(document.createElement('i'), document.createElement('b'));
        cell.firstElementChild!.textContent = name;
        this.#cells[name] = cell;
        this.append(cell);
      }
    }
    // The hold is set on the skin by <ascent-lift>.
    const root = skinRoot(this);
    this.#watch?.disconnect();
    this.#watch = new MutationObserver(() => this.requestUpdate());
    if (root) this.#watch.observe(root, { attributes: true, attributeFilter: ['data-hold'] });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#watch?.disconnect();
    this.#watch = null;
  }

  #set(name: string, state: 'go' | 'hold' | 'wait' | 'off', text: string) {
    const cell = this.#cells[name];
    if (!cell) return;
    cell.dataset.s = state;
    if (cell.lastElementChild!.textContent !== text) cell.lastElementChild!.textContent = text;
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    const playback = this.#playback.value;
    const volume = this.#volume.value;
    const held = skinRoot(this)?.hasAttribute('data-hold') ?? false;
    const lost = Boolean(this.#error.value?.error);
    const quiet = volume ? volume.muted || volume.volume === 0 : false;
    const captions = this.#tracks.value?.subtitlesShowing ?? false;
    const playing = playback ? !playback.paused : false;
    const launched = (playback?.started ?? false) || (this.#time.value?.currentTime ?? 0) > 0.5;
    this.#set('Signal', lost || held ? 'hold' : 'go', lost ? 'Lost' : held ? 'Hold' : 'Go');
    this.#set('Audio', quiet ? 'off' : 'go', quiet ? 'Off' : 'Go');
    this.#set('Captions', captions ? 'go' : 'off', captions ? 'Go' : 'Off');
    if (playback?.ended) this.#set('Flight', 'off', 'Complete');
    else if (playing) this.#set('Flight', 'go', 'Go');
    else if (launched) this.#set('Flight', 'wait', 'Hold');
    else this.#set('Flight', 'off', 'Ready');
  }
}

/**
 * <ascent-next>: the Next event module on the console desk. A countdown to the next chapter with its name; choosing
 * it (or pressing N) skips there. In the last chapter it counts down to the end of the film and is disabled. Hidden
 * without chapters.
 */
class AscentNextElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #button?: HTMLButtonElement;
  #count?: HTMLElement;
  #name?: HTMLElement;

  connectedCallback() {
    super.connectedCallback();
    if (this.#button) return;
    this.innerHTML = `<i class="asc-mh" aria-hidden="true">Next event</i><button type="button" class="asc-nx"><b><span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5zM18.5 5.5v13"/></svg></b><span class="lab"></span></button>`;
    this.#button = this.querySelector('button')!;
    this.#count = this.querySelector('b span')!;
    this.#name = this.querySelector('.lab')!;
    this.#button.addEventListener('click', () => this.skip());
  }

  get #next(): Chapter | undefined {
    const now = this.#time.value?.currentTime ?? 0;
    return (this.#tracks.value?.chaptersCues ?? []).find((chapter) => chapter.startTime > now + 0.05);
  }

  /** Fly to the next event, if there is one. */
  skip() {
    const next = this.#next;
    if (!next) return;
    void this.#time.value?.seek(next.startTime + 0.01);
    liftFor(this)?.wake();
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    const chapters = this.#tracks.value?.chaptersCues ?? [];
    this.hidden = !chapters.length;
    if (!chapters.length || !this.#button || !this.#count || !this.#name) return;
    const time = this.#time.value;
    const duration = time && Number.isFinite(time.duration) && time.duration > 0 ? time.duration : chapters[chapters.length - 1].endTime;
    const next = this.#next;
    this.#count.textContent = `T− ${clock((next ? next.startTime : duration) - (time?.currentTime ?? 0))}`;
    const name = next ? next.text : 'End of film';
    if (this.#name.textContent !== name) {
      this.#name.textContent = name;
      this.#button.disabled = !next;
      this.#button.setAttribute('aria-label', next ? `Skip to the next event, ${next.text}` : 'No next event');
    }
  }
}

/** <ascent-clock>: the mission clock, at the right end of the console desk. Choosing it switches between time elapsed and time remaining. */
class AscentClockElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #remaining = false;
  #button?: HTMLButtonElement;
  #label?: HTMLElement;
  #digits?: HTMLElement;

  connectedCallback() {
    super.connectedCallback();
    if (this.#button) return;
    this.#button = document.createElement('button');
    this.#button.type = 'button';
    this.#label = document.createElement('span');
    this.#label.className = 'lab';
    this.#digits = document.createElement('b');
    this.#button.append(this.#label, this.#digits);
    this.append(this.#button);
    this.#button.addEventListener('click', () => {
      this.#remaining = !this.#remaining;
      this.requestUpdate();
    });
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    if (!this.#button || !this.#label || !this.#digits) return;
    const time = this.#time.value;
    const duration = time && Number.isFinite(time.duration) ? time.duration : 0;
    const current = time?.currentTime ?? 0;
    const remaining = this.#remaining;
    this.#digits.textContent = remaining ? `−${clock(duration - current)}` : clock(current);
    this.#label.textContent = remaining ? `T− remaining · of ${clock(duration)}` : `T+ elapsed · of ${clock(duration)}`;
    this.#button.setAttribute(
      'aria-label',
      remaining ? 'Time remaining. Switch to elapsed time' : 'Elapsed time. Switch to time remaining'
    );
  }
}

/**
 * Ascent sets captions itself, so they can rise with the HUD. A plain `<video>` is reached from skin.css; media
 * elements that keep their `<video>` in a shadow root draw cues where page styles cannot reach.
 */
function hideNativeCues(media: HTMLMediaElement) {
  const shadow = media.shadowRoot;
  if (!shadow || shadow.querySelector('style[data-ascent]')) return;
  const style = document.createElement('style');
  style.dataset.ascent = '';
  style.textContent =
    'video::-webkit-media-text-track-container{display:none}video::cue{color:transparent;background:transparent}';
  shadow.append(style);
}

/** <ascent-captions>: the showing captions or subtitles track's active cues, set above the path. */
class AscentCaptionsElement extends UIElement {
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #media: HTMLMediaElement | null = null;
  #abort: AbortController | null = null;
  #attempts = 0;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#abort?.abort();
    this.#abort = new AbortController();
    this.#attempts = 0;
    this.#attach(this.#abort.signal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
  }

  /** Custom media elements may upgrade a frame or two after the template mounts. */
  #attach(signal: AbortSignal) {
    const root = skinRoot(this);
    const media = root ? findMedia(root) : null;
    if (!media) {
      if (this.#attempts++ < 120 && !signal.aborted) requestAnimationFrame(() => this.#attach(signal));
      return;
    }
    this.#media = media;
    hideNativeCues(media);
    const render = () => this.#render();
    const tracks = media.textTracks;
    const watch = (track: TextTrack) => track.addEventListener('cuechange', render, { signal });
    for (const track of tracks) watch(track);
    tracks.addEventListener('addtrack', (event) => event.track && watch(event.track), { signal });
    tracks.addEventListener('change', render, { signal });
    // Active cues settle a tick after a seek on streamed media; timeupdate catches that too.
    for (const type of ['seeked', 'timeupdate']) media.addEventListener(type, render, { signal });
    render();
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    this.#render();
  }

  #render() {
    const showing = this.#tracks.value?.subtitlesShowing ?? false;
    let text = '';
    if (showing && this.#media) {
      for (const track of this.#media.textTracks) {
        if (track.mode !== 'showing' || (track.kind !== 'captions' && track.kind !== 'subtitles')) continue;
        const lines: string[] = [];
        for (const cue of track.activeCues ?? []) {
          const raw = (cue as VTTCue).text ?? '';
          lines.push(raw.replace(/<[^>]+>/g, ''));
        }
        text = lines.join('\n');
        break;
      }
    }
    if (this.textContent !== text) this.textContent = text;
  }
}

/**
 * <ascent-keys>: the keys Video.js hotkeys do not cover. Digits 1–9 fly to that event and N to the next one. It also
 * keeps Page Up and Page Down (the hotkeys, and the time slider's own keys) at a tenth of the film, and moves the
 * light on each glass key to follow the pointer.
 */
class AscentKeysElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #abort: AbortController | null = null;
  #tenth = 0;

  connectedCallback() {
    super.connectedCallback();
    this.hidden = true;
    this.#abort?.abort();
    this.#abort = new AbortController();
    const root = skinRoot(this);
    root?.addEventListener(
      'keydown',
      (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if ((event.target as Element).closest('input, textarea, select, [contenteditable]')) return;
        if (event.key === 'n' || event.key === 'N') {
          const next = root.querySelector<AscentNextElement>('ascent-next');
          if (!next || next.hidden) return;
          event.preventDefault();
          next.skip();
          return;
        }
        if (!/^[1-9]$/.test(event.key)) return;
        const chapter = (this.#tracks.value?.chaptersCues ?? [])[Number(event.key) - 1];
        if (!chapter) return;
        event.preventDefault();
        void this.#time.value?.seek(chapter.startTime + 0.01);
        liftFor(this)?.wake();
      },
      { signal: this.#abort.signal }
    );
    root?.addEventListener(
      'pointermove',
      (event) => {
        const key = (event.target as Element).closest?.<HTMLElement>('.asc-b');
        if (!key) return;
        const rect = key.getBoundingClientRect();
        key.style.setProperty('--mx', `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(0)}%`);
        key.style.setProperty('--my', `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(0)}%`);
      },
      { signal: this.#abort.signal }
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    const duration = this.#time.value?.duration ?? 0;
    const tenth = Number.isFinite(duration) && duration > 0 ? Math.round(duration) / 10 : 0;
    if (!tenth || tenth === this.#tenth) return;
    this.#tenth = tenth;
    skinRoot(this)
      ?.querySelectorAll<HTMLElement>('media-hotkey[data-asc-tenth]')
      .forEach((hotkey) => hotkey.setAttribute('value', String(tenth * Number(hotkey.dataset.ascTenth))));
    // The time slider's own Page Up / Page Down (when it has focus) move by the same tenth.
    skinRoot(this)?.querySelector('media-time-slider')?.setAttribute('large-step', String(tenth));
  }
}

/**
 * <ascent-lift>: the idle behaviour. The HUD shows on pointer movement, a tap, a key, keyboard focus, or a pause.
 * Three seconds into playing without any of those, it lifts away and the path sinks to the bottom edge and fades out,
 * leaving only the film (and captions). With reduced motion the change is instant.
 *
 * It also calls the hold: while the film buffers (the `<media-buffering-indicator>` is showing) the skin carries
 * `data-hold`, the HUD stays up, the craft vents and the Signal lamp reads Hold. And it marks ignition: `data-ignite`
 * for a moment each time the film starts playing, which flares the craft's engine.
 *
 * A tap on the picture plays or pauses, unless the HUD was away: then the tap only brings it back.
 */
class AscentLiftElement extends UIElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #abort: AbortController | null = null;
  #root: HTMLElement | null = null;
  #lift: Lift | null = null;
  #target = 1;
  #timer = 0;
  #frame = 0;
  #paused: boolean | null = null;
  #wokeByPress = false;
  #ignite = 0;

  connectedCallback() {
    super.connectedCallback();
    this.hidden = true;
    this.#abort?.abort();
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    this.#root = skinRoot(this);
    this.#lift = liftFor(this);
    if (!this.#root || !this.#lift) return;
    const root = this.#root;
    this.#lift.wake = () => this.#wake();

    for (const type of ['pointermove', 'keydown', 'focusin']) root.addEventListener(type, () => this.#wake(), { signal });
    root.addEventListener(
      'pointerdown',
      () => {
        this.#wokeByPress = root.hasAttribute('data-idle');
        this.#wake();
      },
      { signal, capture: true }
    );
    root.addEventListener(
      'pointerleave',
      () => {
        if (this.#isPaused) return;
        clearTimeout(this.#timer);
        this.#timer = window.setTimeout(() => this.#sleep(), 900);
      },
      { signal }
    );
    root.addEventListener('click', (event) => this.#onClick(event), { signal });
    root.style.setProperty('--lift', '1');
    root.toggleAttribute('data-capup', true);
    const indicator = root.querySelector('media-buffering-indicator');
    const hold = new MutationObserver(() => {
      const held = indicator?.hasAttribute('data-visible') ?? false;
      if (held === root.hasAttribute('data-hold')) return;
      root.toggleAttribute('data-hold', held);
      this.#wake();
    });
    if (indicator) hold.observe(indicator, { attributes: true, attributeFilter: ['data-visible'] });
    signal.addEventListener('abort', () => {
      hold.disconnect();
      clearTimeout(this.#ignite);
      clearTimeout(this.#timer);
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
  }

  protected update(changed: PropertyValues) {
    super.update(changed);
    const paused = this.#isPaused;
    if (paused !== this.#paused) {
      if (this.#paused && !paused && !reducedMotion()) {
        const root = this.#root;
        root?.setAttribute('data-ignite', '');
        clearTimeout(this.#ignite);
        this.#ignite = window.setTimeout(() => root?.removeAttribute('data-ignite'), 820);
      }
      this.#paused = paused;
      this.#wake();
    }
  }

  get #isPaused(): boolean {
    return this.#playback.value?.paused ?? true;
  }

  #onClick(event: MouseEvent) {
    const target = event.target as Element;
    if (event.button !== 0 || !this.#root) return;
    if (target.closest('.asc-fade, media-time-slider, media-error-dialog, button, [role="button"], [role="slider"], a')) return;
    if (this.#wokeByPress) {
      this.#wokeByPress = false;
      return;
    }
    const playback = this.#playback.value;
    if (!playback) return;
    if (playback.paused) void Promise.resolve(playback.play()).catch(() => {});
    else playback.pause();
  }

  #wake() {
    this.#target = 1;
    this.#root?.removeAttribute('data-idle');
    if (this.#lift) this.#lift.idle = false;
    clearTimeout(this.#timer);
    if (!this.#isPaused) this.#timer = window.setTimeout(() => this.#sleep(true), 3000);
    this.#animate();
  }

  #sleep(checkHeld = false) {
    const root = this.#root;
    if (!root || this.#isPaused || root.hasAttribute('data-hold')) return;
    if (checkHeld) {
      const dragging = root.querySelector('[data-dragging]');
      let keyboard = false;
      try {
        keyboard = root.matches(':focus-within:has(:focus-visible)');
      } catch {
        keyboard = false;
      }
      if (dragging || keyboard) return;
    }
    this.#target = 0;
    root.setAttribute('data-idle', '');
    if (this.#lift) this.#lift.idle = true;
    this.#animate();
  }

  #animate() {
    if (this.#frame) return;
    const step = () => {
      this.#frame = 0;
      const lift = this.#lift;
      const root = this.#root;
      if (!lift || !root) return;
      let value = lift.value;
      if (reducedMotion() || Math.abs(value - this.#target) <= 0.002) value = this.#target;
      else value += (this.#target - value) * 0.16;
      root.style.setProperty('--lift', value.toFixed(3));
      root.toggleAttribute('data-capup', value > 0.5);
      lift.set(value);
      if (value !== this.#target) this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }
}

for (const [name, element] of [
  ['ascent-flight', AscentFlightElement],
  ['ascent-events', AscentEventsElement],
  ['ascent-now', AscentNowElement],
  ['ascent-engine', AscentEngineElement],
  ['ascent-play-label', AscentPlayLabelElement],
  ['ascent-board', AscentBoardElement],
  ['ascent-next', AscentNextElement],
  ['ascent-rate', AscentRateElement],
  ['ascent-clock', AscentClockElement],
  ['ascent-captions', AscentCaptionsElement],
  ['ascent-keys', AscentKeysElement],
  ['ascent-lift', AscentLiftElement],
] as const) {
  if (!customElements.get(name)) customElements.define(name, element);
}
