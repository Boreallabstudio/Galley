import {
  PlayerController,
  playerContext,
  selectBuffer,
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

/**
 * <ascent-flight>: the flight path. A dotted course still to fly, the buffered stretch ahead, the flown part in orange
 * with a glow, a dot for each chapter and the craft at the playhead. Purely visual (`aria-hidden`); the
 * `<media-time-slider>` underneath it carries the interaction, and its thumb is moved onto the craft here.
 */
class AscentFlightElement extends PathElement {
  #buffer = new PlayerController(this, playerContext, selectBuffer);
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
    this.innerHTML = `<svg xmlns="${SVG}">
<defs><filter id="${glow}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter></defs>
<path class="under" fill="none" stroke="rgba(3,5,9,.32)" stroke-width="5" stroke-linecap="round"/>
<path class="rest" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 9" opacity=".55"/>
<path class="buf" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".5"/>
<path class="glow" fill="none" stroke="${BURN}" stroke-width="10" opacity=".45" filter="url(#${glow})"/>
<path class="done" fill="none" stroke="${BURN}" stroke-width="4" stroke-linecap="round"/>
<g class="dots"></g>
<g class="craft"><circle r="26" fill="${BURN}" opacity=".5" filter="url(#${glow})"/><circle class="craft-ring" r="17" fill="rgba(3,5,9,.35)" stroke="${INK}" stroke-width="1.5"/><path class="arrow" d="M15 0L-8 -8L-3 0L-8 8Z" fill="${INK}"/></g>
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
    const scale = Math.max(0.62, Math.min(1, W / 1100)) * (0.35 + 0.65 * lift);
    const cx = pathX(g, t);
    const cy = pathY(g, t);
    this.#craft.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${scale.toFixed(3)})`);
    this.#arrow.setAttribute('transform', `rotate(${angle.toFixed(1)})`);

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
      dot.setAttribute('r', (6 * Math.max(0.7, Math.min(1, W / 1100))).toFixed(2));
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

/* ---------- thrusters ---------- */

interface ThrusterDrawing {
  set(fraction: number, reading: string): void;
  fractionAt(event: PointerEvent): number;
}

/** The value range on the thruster drawing (viewBox 0 0 110 28): from just past the nozzle to near the end. */
const THR_X0 = 27;
const THR_X1 = 100;
const THR_C = 14;
const NOZZLE_EXIT = 16.4;

/** An exhaust plume from the nozzle exit (x 16) to `x`, `h` high at the exit, tapering to a point. */
function plume(x: number, h: number): string {
  const l = x - 16;
  const f = (n: number) => n.toFixed(1);
  return (
    `M16 ${f(THR_C - h)}C${f(16 + l * 0.4)} ${f(THR_C - h * 1.05)} ${f(16 + l * 0.78)} ${f(THR_C - h * 0.42)} ${f(x)} ${THR_C}` +
    `C${f(16 + l * 0.78)} ${f(THR_C + h * 0.42)} ${f(16 + l * 0.4)} ${f(THR_C + h * 1.05)} 16 ${f(THR_C + h)}Z`
  );
}

/**
 * Draw a thruster slider into `host`, with a readout beside it: a solid engine nozzle at the left and the value
 * along the exhaust, x 27–100 of 110.
 *
 * `stops` = 0 (volume): an orange plume with a pale hot core runs from the nozzle to the value, where a ring knob
 * sits; a dotted guide and an end tick show the rest of the range. At zero there is no plume.
 * `stops` > 0 (speed): a shock diamond per stop, lit up to the value and hollow beyond, over a thin exhaust band,
 * with a ring around the current one.
 */
function drawThruster(host: HTMLElement, stops: number): ThrusterDrawing {
  const glow = nextId('asc-thr-glow');
  const sx = (i: number) => THR_X0 + ((THR_X1 - THR_X0) * i) / (stops - 1);
  let diamonds = '';
  for (let i = 0; i < stops; i++) {
    const cx = sx(i);
    const hh = 5.4 - i * 0.28;
    diamonds += `<path d="M${(cx - 5).toFixed(1)} ${THR_C}L${cx.toFixed(1)} ${(THR_C - hh).toFixed(1)}L${(cx + 5).toFixed(1)} ${THR_C}L${cx.toFixed(1)} ${(THR_C + hh).toFixed(1)}Z" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  const guide = stops
    ? ''
    : `<path class="tr" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="1.5 5" opacity=".6"/><path d="M104.5 9.5V18.5" stroke="${INK}" stroke-width="1.3" stroke-linecap="round" opacity=".6"/>`;
  const knob = stops
    ? `<circle r="8.2" fill="none" stroke="${INK}" stroke-width="1.4"/>`
    : `<circle r="7" fill="rgba(3,5,9,.6)" stroke="${INK}" stroke-width="1.4"/><circle r="2.4" fill="${INK}"/>`;
  host.insertAdjacentHTML(
    'afterbegin',
    `<svg class="asc-thr-svg" viewBox="0 0 110 28" aria-hidden="true"><defs><filter id="${glow}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter></defs>${guide}<path class="tg" fill="${BURN}" opacity=".45" filter="url(#${glow})"/><path class="tp" fill="${BURN}"/><path class="tc" fill="#ffd9bf" opacity=".92"/><g class="ts">${diamonds}</g><rect x="2" y="10.5" width="5" height="7" rx="1.6" fill="${INK}"/><path d="M6.5 12.6H8.5C11 12.2 14 10 ${NOZZLE_EXIT} 6V22C14 18 11 15.8 8.5 15.4H6.5Z" fill="${INK}"/><g class="tk">${knob}</g></svg><span class="asc-thr-read" aria-hidden="true"></span>`
  );
  const svg = host.querySelector('svg')!;
  const q = (selector: string) => svg.querySelector(selector)!;
  const reading = host.querySelector('.asc-thr-read')!;
  const shocks = [...svg.querySelectorAll('.ts path')];
  return {
    set(fraction, text) {
      const f = Math.min(1, Math.max(0, fraction));
      const x = THR_X0 + (THR_X1 - THR_X0) * f;
      const on = stops > 0 || f > 0;
      q('.tp').setAttribute('d', on ? plume(x, stops ? 3.2 : 7.2) : '');
      q('.tg').setAttribute('d', on ? plume(x, stops ? 4.4 : 7.2) : '');
      q('.tc').setAttribute('d', on && !stops ? plume(16 + (x - 16) * 0.6, 2.8) : '');
      if (!stops) q('.tr').setAttribute('d', `M${(x + 10).toFixed(1)} ${THR_C}H104`);
      q('.tk').setAttribute('transform', `translate(${x.toFixed(1)} ${THR_C})`);
      reading.textContent = text;
      shocks.forEach((shock, i) => {
        const lit = i / (stops - 1) <= f + 1e-6;
        shock.setAttribute('fill', lit ? BURN : '#05070b');
        shock.setAttribute('stroke', lit ? '#ffb08c' : INK);
        shock.setAttribute('opacity', lit ? '1' : '.75');
      });
    },
    fractionAt({ clientX }) {
      const rect = svg.getBoundingClientRect();
      const k = rect.width / 110;
      return ((clientX - rect.left) / k - THR_X0) / (THR_X1 - THR_X0);
    },
  };
}

const DEFAULT_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * <ascent-ladder kind="volume">: the volume thruster. A horizontal `<media-volume-slider>` inside it, laid exactly
 * over the drawn range, is the accessible slider and takes pointer, wheel and keys; this element only draws.
 *
 * <ascent-ladder kind="speed">: the speed thruster. Video.js 10 has no playback-rate slider, so this element is the
 * slider itself (`role="slider"`), setting the rate through the player's playback-rate feature and snapping to the
 * player's rates.
 *
 * `size="jet"` is the inline control in the bottom row of wide players. `size="pop"` puts the same drawing on a small
 * plate that pops up above the mute button or the speed pill in mid-size players. On touch, the first tap on that
 * button opens the pop-up and the second performs the button's action.
 */
class AscentLadderElement extends UIElement {
  static properties = { kind: { type: String }, size: { type: String } };
  kind = 'volume';
  size = 'jet';

  #volume = new PlayerController(this, playerContext, selectVolume);
  #rate = new PlayerController(this, playerContext, selectPlaybackRate);
  #drawing: ThrusterDrawing | null = null;
  #abort: AbortController | null = null;

  get #speed() {
    return this.kind === 'speed';
  }

  connectedCallback() {
    super.connectedCallback();
    this.#abort?.abort();
    this.#abort = new AbortController();
    if (!this.#drawing) this.#drawing = drawThruster(this, this.#speed ? DEFAULT_RATES.length : 0);
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

  #bindSpeed(signal: AbortSignal) {
    this.setAttribute('role', 'slider');
    this.setAttribute('tabindex', '0');
    this.setAttribute('aria-label', 'Playback speed');
    this.setAttribute('aria-orientation', 'horizontal');
    this.setAttribute('aria-valuemin', '0.5');
    this.setAttribute('aria-valuemax', '2');

    const fromPointer = (event: PointerEvent) => {
      const f = Math.min(1, Math.max(0, this.#drawing!.fractionAt(event)));
      this.#setRate(0.5 + 1.5 * f);
    };
    this.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        this.setPointerCapture(event.pointerId);
        this.setAttribute('data-dragging', '');
        fromPointer(event);
      },
      { signal }
    );
    this.addEventListener('pointermove', (event) => this.hasAttribute('data-dragging') && fromPointer(event), { signal });
    const end = () => this.removeAttribute('data-dragging');
    this.addEventListener('pointerup', end, { signal });
    this.addEventListener('pointercancel', end, { signal });
    this.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.#step(event.deltaY < 0 ? 1 : -1);
      },
      { signal, passive: false }
    );
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

/** <ascent-clock>: the mission clock, bottom right. Choosing it switches between time elapsed and time remaining. */
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
 * <ascent-keys>: the keys Video.js hotkeys do not cover. Digits 1–9 fly to that event. It also keeps Page Up and
 * Page Down (the hotkeys, and the time slider's own keys) at a tenth of the film.
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
        if (!/^[1-9]$/.test(event.key)) return;
        if ((event.target as Element).closest('input, textarea, select, [contenteditable]')) return;
        const chapter = (this.#tracks.value?.chaptersCues ?? [])[Number(event.key) - 1];
        if (!chapter) return;
        event.preventDefault();
        void this.#time.value?.seek(chapter.startTime + 0.01);
        liftFor(this)?.wake();
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
    signal.addEventListener('abort', () => {
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
    if (!root || this.#isPaused) return;
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
  ['ascent-ladder', AscentLadderElement],
  ['ascent-rate', AscentRateElement],
  ['ascent-clock', AscentClockElement],
  ['ascent-captions', AscentCaptionsElement],
  ['ascent-keys', AscentKeysElement],
  ['ascent-lift', AscentLiftElement],
] as const) {
  if (!customElements.get(name)) customElements.define(name, element);
}
