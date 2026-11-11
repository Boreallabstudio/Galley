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
  type Geometry,
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
/** Changes an element's words. A change (not the first fill) eases in from just below, so labels never snap. */
function setWords(element: Element, text: string) {
  if (element.textContent === text) return;
  const first = !element.textContent;
  element.textContent = text;
  if (first || reducedMotion() || !(element instanceof HTMLElement)) return;
  element.animate(
    [
      { opacity: 0, transform: 'translateY(0.4em)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
  );
}

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
    if (this.slider) watch.observe(this.slider, { attributes: true, attributeFilter: ['style', 'data-dragging', 'data-pointing'] });
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
 * with a glow, a dot for each chapter and the craft at the playhead. The craft's engine glow is an ember when paused
 * and grows with the playback rate. While the film plays a booster flame burns behind the craft (`data-burn`), longer
 * at higher rates, it flares at ignition (`data-ignite` on the skin) and pulls back into the nozzle when the film is
 * paused (`data-cut`), after which the craft holds with a slow beacon. A launch from the start of the film, or a
 * hold there, also raises a cloud from the pad (`data-pad`): the corner between the player's left edge and the desk.
 * Anywhere else on the path the takeoff has already happened, so there is the booster and nothing more. Flame and
 * cloud are baked fluid simulations played as sprites (`.asc-booster`, `.asc-liftoff`; see skin.css and tools/plume);
 * this element only keeps them in place. When the film ends (`data-arrived`) a light runs up the flown path and the
 * craft flies on into a parking orbit past the end of it, where it stays until the film is flown again. Purely
 * visual (`aria-hidden`); the `<media-time-slider>` underneath it carries the interaction, and its thumb is kept on
 * the path at the playhead here.
 */
/** Booster sprite at full size, in CSS pixels, and its frame's height as a share of its width. */
const BOOSTER_WIDTH = 190;
const BOOSTER_RATIO = 118 / 384;
/** Liftoff cloud at full size, and how far its simulated wall stands behind the craft: it is scaled until that wall
 * is the player's left edge. */
const LIFTOFF_WIDTH = 340;
const LIFTOFF_RATIO = 294 / 400;
const LIFTOFF_WALL = 62;
/** The film counts as still on the pad for this many seconds. */
const PAD_SECONDS = 1.2;
/** How long the engine takes to cut off after a pause. Matches skin.css. */
const CUTOFF_MS = 600;
/**
 * The end of the film. A light runs up the flown path and each event answers as it passes (`ARRIVAL_MS`), then the
 * craft leaves the end of the path for a parking orbit around a small body: an ellipse with semi-axes `ORBIT_A` and
 * `ORBIT_B` at full size, tilted so it reads as a circle seen at an angle, touching the path where the path ends.
 * The whole orbit shows as a faint closed course as the craft sets off. A lap takes `ORBIT_LAP_MS`; the craft eases up to
 * that speed over `ORBIT_ENTRY_MS` and lights the orbit behind it on its first lap.
 */
const ARRIVAL_MS = 1200;
const ORBIT_A = 56;
const ORBIT_B = 25;
const ORBIT_LAP_MS = 9000;
const ORBIT_ENTRY_MS = 1800;
/** The craft keeps its full size in orbit, and the orbit keeps this clear of the player's right edge (orbit units). */
const ORBIT_CRAFT = 1;
const ORBIT_INSET = 40;

interface Orbit {
  /** The parameter of the ellipse's lowest point: the craft joins the orbit there, flying level. */
  join: number;
  /** A point on the orbit, measured from the join, and the heading of a craft passing it. */
  at(u: number): { x: number; y: number; heading: number };
  /** The body the craft goes around, measured from the join. */
  centre: { x: number; y: number };
}

/**
 * The parking orbit that fits `room`: the space between the end of the path and the player's edge, in the orbit's
 * own units. The flatter the ellipse lies the further it reaches past the end of the path, so a narrow player gets
 * a steeper one.
 */
function parkingOrbit(room: number): Orbit {
  let tilt = 18;
  let cos = 1;
  let sin = 0;
  let join = 0;
  const reachFrom = (v: number) =>
    Math.hypot(ORBIT_A * cos, ORBIT_B * sin) - (ORBIT_A * Math.cos(v) * cos - ORBIT_B * Math.sin(v) * sin);
  const fits = (v: number) => reachFrom(v) + 17 * ORBIT_CRAFT + ORBIT_INSET <= room;
  let fitted = false;
  for (; tilt <= 44 && !fitted; tilt += 2) {
    cos = Math.cos((tilt * Math.PI) / 180);
    sin = Math.sin((tilt * Math.PI) / 180);
    join = Math.atan2(ORBIT_B * cos, ORBIT_A * sin);
    fitted = fits(join);
  }
  // Still too little room: the craft joins further round, climbing, so the orbit hangs back over the end of the path
  // instead of running off the edge. At most it joins at the orbit's rightmost point.
  if (!fitted) {
    const rightmost = Math.atan2(-ORBIT_B * sin, ORBIT_A * cos);
    const lowest = join;
    for (let k = 0; k <= 1 && !fits(join); k += 0.05) join = lowest + (rightmost - lowest) * k;
  }
  const x = (v: number) => ORBIT_A * Math.cos(v) * cos - ORBIT_B * Math.sin(v) * sin;
  const y = (v: number) => ORBIT_A * Math.cos(v) * sin + ORBIT_B * Math.sin(v) * cos;
  return {
    join,
    centre: { x: -x(join), y: -y(join) },
    at: (u) => ({
      x: x(u) - x(join),
      y: y(u) - y(join),
      heading: Math.atan2(
        ORBIT_A * Math.sin(u) * sin - ORBIT_B * Math.cos(u) * cos,
        ORBIT_A * Math.sin(u) * cos + ORBIT_B * Math.cos(u) * sin
      ),
    }),
  };
}

/**
 * The craft goes into orbit as soon as the last event (the credits) begins, and stays there to the end of the film.
 * A film without events goes into orbit when it ends.
 */
function inOrbit(chapters: readonly Chapter[], currentTime: number, ended: boolean): boolean {
  if (ended) return true;
  const last = chapters.length > 1 ? chapters[chapters.length - 1] : undefined;
  return last ? currentTime >= last.startTime - 0.05 : false;
}

/** Drawn sizes follow the player: smaller under 1100 px, larger on very big screens. */
const sizeFor = (width: number) => Math.max(0.62, Math.min(1, width / 1100)) * Math.min(1.45, Math.max(1, width / 1600));
/** How large the craft is drawn: its size for this player, shrinking as the HUD lowers. */
const craftScale = (width: number, lift: number) => sizeFor(width) * (0.35 + 0.65 * lift);
/** The path's heading at `t`, in radians. */
const headingAt = (g: Geometry, t: number) =>
  Math.atan2(
    pathY(g, Math.min(1, t + 0.004)) - pathY(g, Math.max(0, t - 0.004)),
    pathX(g, Math.min(1, t + 0.004)) - pathX(g, Math.max(0, t - 0.004))
  );

/** The parking orbit for a path, placed in the skin: the orbit, and how to turn its points into skin pixels. */
function placedOrbit(g: Geometry, width: number, scale: number) {
  const orbit = parkingOrbit((width - g.x1) / scale);
  const turn = headingAt(g, 1);
  const x0 = pathX(g, 1);
  const y0 = pathY(g, 1);
  const place = (p: { x: number; y: number }) => ({
    x: x0 + scale * (p.x * Math.cos(turn) - p.y * Math.sin(turn)),
    y: y0 + scale * (p.x * Math.sin(turn) + p.y * Math.cos(turn)),
  });
  return { orbit, turn, place };
}

/** The box the parking orbit takes up with the craft on it, in skin pixels. */
function orbitBox(g: Geometry, width: number, lift: number) {
  const scale = craftScale(width, lift);
  const { orbit, place } = placedOrbit(g, width, scale);
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let i = 0; i < 48; i++) {
    const p = place(orbit.at((i / 48) * 2 * Math.PI));
    box.left = Math.min(box.left, p.x);
    box.right = Math.max(box.right, p.x);
    box.top = Math.min(box.top, p.y);
    box.bottom = Math.max(box.bottom, p.y);
  }
  const craft = 17 * ORBIT_CRAFT * 1.1 * scale + 3;
  return { left: box.left - craft, top: box.top - craft, right: box.right + craft, bottom: box.bottom + craft };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

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
  #booster!: HTMLElement;
  #liftoff!: HTMLElement;
  #fxAt = '';
  #onPad = true;
  #cut = 0;
  #sweep!: SVGPathElement;
  #orbit!: SVGPathElement;
  #orbitTrack!: SVGPathElement;
  #orbitGlow!: SVGPathElement;
  #body!: SVGGElement;
  /** Where the craft sits on the path, as last drawn. */
  #at: {
    g: Geometry;
    t: number;
    scale: number;
    size: number;
    rate: number;
    marks: number[];
    lift: number;
    burning: boolean;
  } | null = null;
  /** Whether the craft is on its way into orbit or in it. */
  #arrived = false;
  /** Time since the arrival began, in ms. It stops while the film is paused once the craft is in orbit. */
  #elapsed = 0;
  #tick = 0;
  #paused = false;
  #lap = 0;
  #lit = false;

  connectedCallback() {
    if (!this.#svg) this.#build();
    super.connectedCallback();
  }

  #build() {
    this.setAttribute('aria-hidden', 'true');
    const glow = nextId('asc-glow');
    this.innerHTML = `<div class="asc-liftoff asc-fx"><i></i><i></i></div><svg xmlns="${SVG}">
<defs><filter id="${glow}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter></defs>
<path class="under" fill="none" stroke="rgba(3,5,9,.32)" stroke-width="5" stroke-linecap="round"/>
<path class="rest" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="2.5 8" opacity=".7"/>
<path class="buf" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".5"/>
<path class="glow" fill="none" stroke="${BURN}" stroke-width="10" opacity=".45" filter="url(#${glow})"/>
<path class="done" fill="none" stroke="${BURN}" stroke-width="4" stroke-linecap="round"/>
<path class="sweep" fill="none" stroke="#ffd2b0" stroke-width="4" stroke-linecap="round" filter="url(#${glow})"/>
<path class="orbit-track" fill="none" stroke="${BURN}" stroke-width="2" stroke-linejoin="round"/>
<path class="orbit-glow" fill="none" stroke="${BURN}" stroke-width="7" filter="url(#${glow})"/>
<path class="orbit" fill="none" stroke="${BURN}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<g class="dots"></g>
<g class="orbit-body"><circle r="5.5" fill="${INK}"/></g>
<g class="craft"><circle class="craft-beacon" r="17" fill="none" stroke="${BURN}" stroke-width="2" opacity="0"/><circle class="craft-beacon late" r="17" fill="none" stroke="${BURN}" stroke-width="2" opacity="0"/><circle class="craft-glow" r="26" fill="${BURN}" opacity=".5" filter="url(#${glow})"/><circle class="craft-ring" r="17" fill="rgba(3,5,9,.35)" stroke="${INK}" stroke-width="1.5"/><path class="arrow" d="M15 0L-8 -8L-3 0L-8 8Z" fill="${INK}"/></g>
</svg><div class="asc-booster"><b class="asc-fx"><i></i><i></i></b></div>`;
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
    this.#booster = q('.asc-booster');
    this.#liftoff = q('.asc-liftoff');
    this.#burn = q('.craft-glow');
    this.#sweep = q('.sweep');
    this.#orbit = q('.orbit');
    this.#orbitTrack = q('.orbit-track');
    this.#orbitGlow = q('.orbit-glow');
    this.#body = q('.orbit-body');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.#lap);
    this.#lap = 0;
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

    // Buffered: the stretch of the range that holds the playhead.
    let ahead = t;
    if (duration > 0) {
      for (const [start, end] of this.#buffer.value?.buffered ?? []) {
        if (start <= currentTime + 0.5 && end > currentTime) ahead = Math.min(1, end / duration);
      }
    }
    this.#buffered.setAttribute('d', pathData(g, t, Math.max(t, ahead)));

    const size = sizeFor(W);
    const big = Math.max(1, size);
    this.#done.setAttribute('stroke-width', (4 * big).toFixed(2));
    this.#glow.setAttribute('stroke-width', (10 * big).toFixed(2));
    this.#rest.setAttribute('stroke-width', (2.6 * big).toFixed(2));
    this.#buffered.setAttribute('stroke-width', (2 * big).toFixed(2));
    this.#under.setAttribute('stroke-width', (5 * big).toFixed(2));
    const scale = craftScale(W, lift);
    this.#sweep.setAttribute('stroke-width', (9 * big).toFixed(2));
    this.#orbit.setAttribute('stroke-width', (2.4 * big).toFixed(2));
    this.#orbitTrack.setAttribute('stroke-width', (2 * big).toFixed(2));
    this.#orbitGlow.setAttribute('stroke-width', (7 * big).toFixed(2));
    const burning = this.#playback.value ? !this.#playback.value.paused : false;
    const rate = this.#rate.value?.playbackRate ?? 1;
    const chapters = duration > 0 ? this.chapters : [];
    const marks = chapters.map((chapter) => Math.min(1, chapter.startTime / duration));

    // One dot per chapter.
    while (this.#dots.children.length > chapters.length) this.#dots.lastChild!.remove();
    while (this.#dots.children.length < chapters.length) {
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('stroke-width', '2');
      this.#dots.append(dot);
    }
    marks.forEach((f, i) => {
      const past = f <= t + 1e-4;
      const dot = this.#dots.children[i];
      dot.setAttribute('cx', pathX(g, f).toFixed(1));
      dot.setAttribute('cy', pathY(g, f).toFixed(1));
      dot.setAttribute('r', (6 * Math.max(0.7, size)).toFixed(2));
      dot.setAttribute('fill', past ? BURN : '#070a0f');
      dot.setAttribute('stroke', past ? BURN : INK);
      dot.setAttribute('opacity', String(lift * (past ? 1 : 0.7)));
    });

    // The credits start the arrival; anything that moves the playhead back out of them calls it off.
    const ended = Boolean(this.#playback.value?.ended);
    this.#paused = !burning && !ended;
    const arrived = inOrbit(chapters, currentTime, ended);
    if (arrived !== this.#arrived) {
      this.#arrived = arrived;
      this.#elapsed = 0;
      this.#tick = performance.now();
      this.toggleAttribute('data-arrived', arrived);
      // The console rises for the credits and stays up through them, so the orbit can be seen.
      if (arrived) this.lift?.wake();
      cancelAnimationFrame(this.#lap);
      this.#lap = arrived && !reducedMotion() ? requestAnimationFrame(this.#fly) : 0;
    }
    this.#at = { g, t, scale, size, rate, marks, lift, burning };
    this.#place();

    // On the pad: the first moments of the film, and until a launch that began there has finished.
    if (currentTime <= PAD_SECONDS) this.#onPad = true;
    else if (!this.root?.hasAttribute('data-ignite')) this.#onPad = false;
    this.toggleAttribute('data-pad', this.#onPad);

    // Engine glow: an ember when paused, brighter and wider with speed.
    this.#burn.setAttribute('r', String(burning ? 18 + 8 * rate : 17));
    this.#burn.setAttribute('opacity', burning ? '.55' : '.3');
  }

  /** The arrival runs on its own clock: the film has stopped, so nothing else asks for a redraw. */
  #fly = () => {
    this.#lap = 0;
    if (!this.#arrived || !this.isConnected) return;
    const now = performance.now();
    // In orbit a pause holds the craft where it is, like everything else; the way in always plays out.
    if (!this.#paused || this.#elapsed < ARRIVAL_MS + ORBIT_ENTRY_MS) this.#elapsed += Math.min(100, now - this.#tick);
    this.#tick = now;
    this.#place();
    this.#lap = requestAnimationFrame(this.#fly);
  };

  /**
   * Put the craft where it belongs: on the path at the playhead or, once the film has ended, on its way around the
   * parking orbit. The booster and the time slider's thumb go with it.
   */
  #place() {
    const at = this.#at;
    if (!at) return;
    const { g, t, scale, size, rate, marks } = at;
    const still = reducedMotion();
    const since = this.#arrived ? (still ? Infinity : this.#elapsed) : 0;
    // On the way into orbit the craft flies the rest of the path while the light runs up behind it.
    const run = Math.min(1, since / ARRIVAL_MS);
    const shown = this.#arrived ? t + (1 - t) * smooth(run) : t;
    const done = pathData(g, 0, shown);
    this.#done.setAttribute('d', done);
    this.#glow.setAttribute('d', done);
    let cx = pathX(g, shown);
    let cy = pathY(g, shown);
    let angle = (headingAt(g, shown) * 180) / Math.PI;
    let craft = scale;
    // The booster burns while the film plays, until the craft is in orbit; it only shows while the HUD is up.
    const lit = at.burning && since < ARRIVAL_MS;
    this.toggleAttribute('data-burn', lit && at.lift > 0.02);
    // Engine cut-off: for a moment after the flame goes out it keeps moving while it pulls back into the nozzle.
    if (lit !== this.#lit) {
      this.#lit = lit;
      clearTimeout(this.#cut);
      this.toggleAttribute('data-cut', !lit);
      if (!lit) this.#cut = window.setTimeout(() => this.removeAttribute('data-cut'), CUTOFF_MS);
    }

    if (this.#arrived) {
      // A light runs up the flown path, and each event answers as it passes.
      const head = 1.2 * smooth(run);
      const tip = Math.min(shown, head);
      this.#sweep.setAttribute('d', head - 0.07 < tip ? pathData(g, Math.max(0, head - 0.07), tip) : '');
      this.#sweep.setAttribute('opacity', (0.75 * Math.min(1, run / 0.15) * Math.min(1, (1 - run) / 0.2)).toFixed(3));
      const dot = 6 * Math.max(0.7, size);
      marks.forEach((f, i) => {
        const answer = run < 1 ? Math.exp(-(((head - f) / 0.07) ** 2)) : 0;
        this.#dots.children[i]?.setAttribute('r', (dot * (1 + 0.3 * answer)).toFixed(2));
      });

      // Then the craft flies on into orbit, drawing it on the first lap.
      const flown = Math.max(0, since - ARRIVAL_MS);
      const speed = (2 * Math.PI) / ORBIT_LAP_MS;
      const swept = still
        ? 2 * Math.PI
        : flown < ORBIT_ENTRY_MS
          ? (speed * flown * flown) / (2 * ORBIT_ENTRY_MS)
          : speed * (flown - ORBIT_ENTRY_MS / 2);
      const { orbit, turn, place: point } = placedOrbit(g, this.width, scale);
      const body = point(orbit.centre);
      this.#body.setAttribute('transform', `translate(${body.x.toFixed(1)} ${body.y.toFixed(1)}) scale(${scale.toFixed(3)})`);
      const drawn = Math.min(swept, 2 * Math.PI);
      const steps = Math.ceil(drawn / 0.09);
      let d = '';
      for (let i = 0; i <= steps; i++) {
        const p = point(orbit.at(orbit.join - (steps ? (drawn * i) / steps : 0)));
        d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
      if (drawn >= 2 * Math.PI) d += 'Z';
      this.#orbit.setAttribute('d', d);
      this.#orbitGlow.setAttribute('d', d);
      // The whole orbit shows at once as a faint closed course round the body; the craft lights it as it flies.
      let track = '';
      for (let i = 0; i < 72; i++) {
        const p = point(orbit.at(orbit.join - (2 * Math.PI * i) / 72));
        track += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
      this.#orbitTrack.setAttribute('d', `${track}Z`);
      // Once the craft has lit the whole lap, the dotted course has done its job.
      this.#orbitTrack.toggleAttribute('data-lit', drawn >= 2 * Math.PI);

      if (still || flown > 0) {
        // With reduced motion the craft is shown already up there, part way round.
        const u = still ? orbit.join - 0.6 * Math.PI : orbit.join - swept;
        const passing = orbit.at(u);
        const p = point(passing);
        craft = scale * ORBIT_CRAFT;
        cx = p.x;
        cy = p.y;
        // Where the craft joins the orbit climbing, it turns from the path's heading onto the orbit's over a moment.
        let heading = passing.heading;
        heading -= 2 * Math.PI * Math.round(heading / (2 * Math.PI));
        const turnIn = still ? 1 : smooth(Math.min(1, flown / 700));
        angle = ((heading * turnIn + turn) * 180) / Math.PI;
      }
    } else {
      this.#sweep.setAttribute('d', '');
    }

    this.#craft.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${craft.toFixed(3)})`);
    this.#arrow.setAttribute('transform', `rotate(${angle.toFixed(1)})`);
    // The booster sits on the craft's tail, turned to its heading; the liftoff cloud stays on the pad. Sizes are whole
    // pixels so the sprites' frames stay exact.
    const boosterW = Math.round(BOOSTER_WIDTH * scale);
    const liftoffW = Math.round((LIFTOFF_WIDTH * this.width * 0.043) / LIFTOFF_WALL);
    const fx = [
      cx.toFixed(1),
      cy.toFixed(1),
      angle.toFixed(1),
      boosterW,
      Math.round(boosterW * BOOSTER_RATIO),
      (17 * scale).toFixed(1),
      Math.min(1.5, Math.max(0.7, 0.8 + 0.2 * rate)).toFixed(2),
      g.x0.toFixed(1),
      g.y0.toFixed(1),
      liftoffW,
      Math.round(liftoffW * LIFTOFF_RATIO),
    ].join();
    if (fx !== this.#fxAt) {
      this.#fxAt = fx;
      const [x, y, turn, bw, bh, back, boost, px, py, lw, lh] = fx.split(',');
      const booster = this.#booster.style;
      booster.setProperty('--fx-x', `${x}px`);
      booster.setProperty('--fx-y', `${y}px`);
      booster.setProperty('--fx-turn', `${turn}deg`);
      booster.setProperty('--fx-w', `${bw}px`);
      booster.setProperty('--fx-h', `${bh}px`);
      booster.setProperty('--fx-back', `${back}px`);
      booster.setProperty('--boost', boost);
      const liftoff = this.#liftoff.style;
      liftoff.setProperty('--fx-x', `${px}px`);
      liftoff.setProperty('--fx-y', `${py}px`);
      liftoff.setProperty('--fx-w', `${lw}px`);
      liftoff.setProperty('--fx-h', `${lh}px`);
    }

    // The slider's thumb (the focusable role="slider") stays on the path at the playhead, so a press or a key
    // lands where the film is.
    const thumb = this.slider?.querySelector<HTMLElement>('media-slider-thumb');
    if (thumb && this.slider) {
      thumb.style.left = `${(pathX(g, t) - this.slider.offsetLeft).toFixed(1)}px`;
      thumb.style.top = `${(pathY(g, t) - this.slider.offsetTop).toFixed(1)}px`;
    }
  }
}

/**
 * <ascent-events>: the film's chapters as events along the path, read from the media's chapters text track.
 * Each is a button that flies the craft there. Without a chapters track it renders nothing.
 */
class AscentEventsElement extends PathElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
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
      const plate = document.createElement('span');
      plate.className = 'plate';
      plate.append(name, mark);
      button.append(plate);
      button.setAttribute('aria-label', `Jump to event ${i + 1}, ${chapter.text}, at ${spoken(chapter.startTime)}`);
      this.append(button);
      return button;
    });
  }

  /** Two events close together in time would print their labels on top of each other. Left to right, a label that
   *  runs into the one before it (plate and all) stands taller on a longer stem until it clears it. */
  #stagger() {
    const GAP = 10;
    type Box = { left: number; right: number; top: number; bottom: number };
    let prev: Box | null = null;
    for (const button of this.#buttons) {
      const rise = parseFloat(button.style.getPropertyValue('--rise')) || 0;
      let box: Box | null = null;
      for (const part of button.querySelectorAll('.plate')) {
        const r = part.getBoundingClientRect();
        if (!r.width) continue;
        // Where the text would sit without any rise.
        const top = r.top + rise;
        const bottom = r.bottom + rise;
        box = box
          ? {
              left: Math.min(box.left, r.left),
              right: Math.max(box.right, r.right),
              top: Math.min(box.top, top),
              bottom: Math.max(box.bottom, bottom),
            }
          : { left: r.left, right: r.right, top, bottom };
      }
      let next = 0;
      if (
        box &&
        prev &&
        box.left < prev.right + GAP &&
        box.right > prev.left - GAP &&
        box.top < prev.bottom + GAP &&
        box.bottom > prev.top - GAP
      ) {
        next = Math.ceil(box.bottom - prev.top + GAP);
      }
      if (Math.abs(next - rise) > 0.5) button.style.setProperty('--rise', `${next}px`);
      if (box) prev = { ...box, top: box.top - next, bottom: box.bottom - next };
    }
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
      // Centred labels sit half a pixel over, so their 1 px stem covers exactly one pixel.
      button.style.left = `${Math.round(pathX(g, f)) + (i ? 0.5 : 0)}px`;
      button.style.top = `${Math.round(pathY(g, f) - 8)}px`;
      button.classList.toggle('past', f <= t + 1e-4);
      button.classList.toggle('cur', i === current);
    });
    this.#stagger();
    // At the end of the film the craft takes up a parking orbit past the last event. A label or stem in its way
    // steps aside; it comes back on hover and focus.
    const orbiting = inOrbit(chapters, currentTime, Boolean(this.#playback.value?.ended));
    const box = orbiting ? orbitBox(g, this.width, this.lift?.value ?? 1) : null;
    const host = box ? (this.root ?? this).getBoundingClientRect() : null;
    // In orbit the credits roll over the film's title card, so the flown events fold down to their nodes and stems
    // (a plate comes back on hover or focus). The last event keeps its label, on a stem tall enough to clear the orbit.
    this.toggleAttribute('data-orbit', orbiting);
    const last = this.#buttons.length - 1;
    // Whether the last label found room above the orbit, under the header readouts.
    let lifted = false;
    if (box && host && last >= 0) {
      const button = this.#buttons[last];
      const r = button.querySelector('.plate')?.getBoundingClientRect();
      if (r && r.width) {
        const rise = parseFloat(button.style.getPropertyValue('--rise')) || 0;
        const top = r.top + rise - host.top;
        const bottom = r.bottom + rise - host.top;
        let ceiling = 0;
        for (const head of (this.root ?? this).querySelectorAll('.asc-title, .asc-now, .asc-board')) {
          const h = head.getBoundingClientRect();
          if (h.width && h.right > r.left && h.left < r.right) ceiling = Math.max(ceiling, h.bottom - host.top + 8);
        }
        const need = Math.max(0, Math.ceil(bottom - (box.top - 10)));
        lifted = top - need >= ceiling;
        const next = lifted ? need : 0;
        if (Math.abs(next - rise) > 0.5) button.style.setProperty('--rise', `${next}px`);
      }
    }
    chapters.forEach((chapter, i) => {
      const button = this.#buttons[i];
      let blocked = false;
      if (box && host && !(i === last && lifted)) {
        const stem = pathX(g, Math.min(1, chapter.startTime / duration));
        blocked = stem > box.left && stem < box.right;
        for (const part of button.children) {
          const r = part.getBoundingClientRect();
          if (!r.width) continue;
          blocked ||=
            r.right - host.left > box.left &&
            r.left - host.left < box.right &&
            r.bottom - host.top > box.top &&
            r.top - host.top < box.bottom;
        }
      }
      button.classList.toggle('clear', blocked);
    });
  }
}

/** <ascent-now>: top right, the event in progress ("Event 04 of 06", "The flame"). Hidden without chapters. */
class AscentNowElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);
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
    // From the credits on, the readout names the flight's last phase, the parking orbit. It names the phase rather than
    // where the craft is, so it holds while the craft is still flying the last of the path, and whatever the film's
    // own story did at its end.
    const ended = Boolean(this.#playback.value?.ended);
    const orbiting = inOrbit(chapters, this.#time.value?.currentTime ?? 0, ended);
    setWords(this.#count, ended ? 'Flight complete' : `Event ${pad2(index + 1)} of ${pad2(chapters.length)}`);
    setWords(this.#name, orbiting ? `${ended ? '' : `${chapters[index].text} · `}Parking orbit` : chapters[index].text);
  }
}

/* ---------- engine dials ---------- */

/** Where a press landed on a dial. */
interface DialHit {
  /**
   * `turn`: on the dial, so the value follows the pointer's angle. `minus` / `plus`: the open quarter at the bottom,
   * which steps. `centre`: too close to the middle to read an angle. `off`: beside the drawing (the readout).
   */
  zone: 'turn' | 'minus' | 'plus' | 'centre' | 'off';
  /** The value at this angle around the ring, 0–1. */
  fraction: number;
  /** Left of the dial's centre line. */
  left: boolean;
  /** In the open quarter at the bottom, between the two ends of the ring. */
  open: boolean;
}

interface DialDrawing {
  set(fraction: number, reading: string): void;
  hit(event: PointerEvent): DialHit;
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
 * Draw an engine dial into `host`, with a readout beside it: the engine seen from behind. A solid body holds a dark
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
    `<svg class="asc-thr-svg" viewBox="-2 -2 52 52" aria-hidden="true"><defs><filter id="${id}-bloom" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.6"/></filter><filter id="${id}-core" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.5"/></filter><linearGradient id="${id}-cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b313b"/><stop offset="1" stop-color="#171b21"/></linearGradient></defs><circle class="tg" cx="24" cy="24" r="12" filter="url(#${id}-bloom)"/><path d="M${dialPoint(DIAL_START, DIAL_R)}A${DIAL_R} ${DIAL_R} 0 1 1 ${dialPoint(DIAL_START + DIAL_SWEEP, DIAL_R)}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" opacity=".2"/><g fill="none" stroke-width="2.6" stroke-linecap="round">${segments}</g>${ticks}<circle cx="24" cy="24" r="16.5" fill="url(#${id}-cap)" stroke="${INK}" stroke-opacity=".2"/><path d="M10.2 16.6A16 16 0 0 1 37.8 16.6" fill="none" stroke="#fff" stroke-opacity=".16" stroke-linecap="round"/><circle cx="24" cy="24" r="10.5" fill="rgba(2,3,5,.85)" stroke="${INK}" stroke-opacity=".28"/><circle class="to" cx="24" cy="24" filter="url(#${id}-core)"/><circle class="tc" cx="24" cy="24" fill="${HOT}"/><path class="tk" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/><g class="pm" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"><path d="M16.6 45.2h4.2"/><path d="M27.2 45.2h4.2M29.3 43.1v4.2"/></g><circle class="gr" r="2.9" fill="${HOT}" stroke="#07090c" stroke-width="1.1"/></svg><span class="asc-thr-read" aria-hidden="true"></span>`
  );
  const svg = host.querySelector('svg')!;
  const q = (selector: string) => svg.querySelector(selector)!;
  const reading = host.querySelector('.asc-thr-read')!;
  const lit = [...svg.querySelectorAll('.sg')];
  const bloom = q('.tg');
  const glow = q('.to');
  const core = q('.tc');
  const tick = q('.tk');
  const grip = q('.gr');
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
      const [gx, gy] = dialPoint(angle, DIAL_R).split(' ');
      grip.setAttribute('cx', gx);
      grip.setAttribute('cy', gy);
      reading.textContent = text;
    },
    hit({ clientX, clientY }) {
      const rect = svg.getBoundingClientRect();
      const box = svg.viewBox.baseVal;
      const x = box.x + (clientX - rect.left) / (rect.width / box.width);
      const y = box.y + (clientY - rect.top) / (rect.height / box.height);
      const left = x < 24;
      const radius = Math.hypot(x - 24, y - 24);
      let angle = (Math.atan2(y - 24, x - 24) * 180) / Math.PI;
      if (angle < DIAL_START - 45) angle += 360;
      // The open quarter at the bottom: its right half is full, its left half is zero.
      const open = angle > DIAL_START + DIAL_SWEEP || angle < DIAL_START;
      const fraction = open ? (left ? 0 : 1) : (angle - DIAL_START) / DIAL_SWEEP;
      const off = clientX < rect.left - 4 || clientX > rect.right + 4;
      const zone = off ? 'off' : radius < 5 ? 'centre' : open && radius > 12 ? (left ? 'minus' : 'plus') : 'turn';
      return { zone, fraction, left, open };
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
 * Both turn the same way, like a knob: press anywhere on the dial and the bright grip on the ring goes to the
 * pointer and follows it round, even after the pointer leaves the dial. The minus and plus at the bottom step it, the
 * wheel steps it, and on touch a tap steps it too (left half down, right half up), so nobody has to drag a small
 * circle with a finger. A drag that starts on the readout beside the dial scrubs it: right or up for more.
 *
 * `size="jet"` is the inline control on the console desk of wide players. `size="pop"` puts the same drawing on a
 * small solid plate that pops up above the mute key or the speed key in mid-size players. On touch, the first tap on
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
  #shown = -1;
  #goal = 0;
  #label = '';
  #tween = 0;

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
    cancelAnimationFrame(this.#tween);
    this.#tween = 0;
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

  /** One step: a tenth of the volume, or one speed stop. */
  #nudge(direction: 1 | -1) {
    if (this.#speed) this.#step(direction);
    else this.#setFraction(Math.round((this.#fraction + direction * 0.1) * 10) / 10);
  }

  /** Pointer and wheel, the same for both dials. */
  #bindPointer(signal: AbortSignal) {
    let down = false;
    let moved = false;
    let turning = false;
    let start: DialHit | null = null;
    let touch = false;
    let x0 = 0;
    let y0 = 0;
    let f0 = 0;
    let last = 0;
    /** The end the dial is held at while the pointer is in, or has crossed, the open quarter. */
    let pinned: 0 | 1 | null = null;
    /**
     * Follow the pointer's angle. A pointer that goes into the open quarter holds the dial at the end it came from,
     * and the dial stays there until the pointer comes back out on that side, so it can never wrap from full to zero.
     */
    const turn = (hit: DialHit) => {
      if (hit.zone === 'centre') return;
      if (hit.open) {
        pinned ??= last > 0.5 ? 1 : 0;
        last = pinned;
      } else {
        if (pinned !== null && Math.abs(hit.fraction - pinned) > 0.5) return;
        pinned = null;
        last = hit.fraction;
      }
      this.#setFraction(last);
    };
    this.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        down = true;
        moved = false;
        touch = event.pointerType === 'touch';
        x0 = event.clientX;
        y0 = event.clientY;
        f0 = last = this.#fraction;
        pinned = null;
        start = this.#drawing!.hit(event);
        // A mouse or pen press on the dial takes the grip at once. A finger waits to see whether it is a tap.
        turning = !touch && start.zone === 'turn';
        if (turning) {
          last = start.fraction;
          this.#setFraction(last);
        }
        this.setPointerCapture(event.pointerId);
        this.setAttribute('data-dragging', '');
      },
      { signal }
    );
    this.addEventListener(
      'pointermove',
      (event) => {
        if (!down || !start) return;
        const dx = event.clientX - x0;
        const dy = event.clientY - y0;
        if (!moved && Math.hypot(dx, dy) > (touch ? 8 : 3)) {
          moved = true;
          if (start.zone !== 'off') turning = true;
        }
        if (turning) turn(this.#drawing!.hit(event));
        else if (moved) this.#setFraction(f0 + (dx - dy) / 120);
      },
      { signal }
    );
    this.addEventListener(
      'pointerup',
      () => {
        if (down && !moved && start) {
          if (start.zone === 'minus' || start.zone === 'plus') this.#nudge(start.zone === 'plus' ? 1 : -1);
          else if (touch && start.zone !== 'off') this.#nudge(start.left ? -1 : 1);
        }
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
      this.#show(f, rateText(Math.min(2, Math.max(0.5, rate))));
      this.setAttribute('aria-valuenow', String(rate));
      this.setAttribute('aria-valuetext', `${rate} times`);
      this.hidden = this.#rate.value?.playbackRateAvailability === 'unsupported';
    } else {
      const volume = this.#volume.value;
      const f = volume ? (volume.muted ? 0 : volume.volume) : 1;
      this.#show(f, String(Math.round(f * 100)));
    }
  }

  /** Moves the dial to `f`. A step from a key, the wheel or a press glides there; a drag follows the hand exactly. */
  #show(f: number, label: string) {
    const drawing = this.#drawing;
    if (!drawing) return;
    this.#goal = f;
    this.#label = label;
    if (this.#shown < 0 || this.hasAttribute('data-dragging') || reducedMotion()) {
      cancelAnimationFrame(this.#tween);
      this.#tween = 0;
      this.#shown = f;
      drawing.set(f, label);
      return;
    }
    if (this.#tween) return;
    const step = () => {
      const gap = this.#goal - this.#shown;
      this.#shown = Math.abs(gap) < 0.004 ? this.#goal : this.#shown + gap * 0.24;
      drawing.set(this.#shown, this.#label);
      this.#tween = this.#shown === this.#goal ? 0 : requestAnimationFrame(step);
    };
    this.#tween = requestAnimationFrame(step);
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
    setWords(this, text);
  }
}

/**
 * <ascent-board>: the go / no-go board, top centre on wide players. Four lamps follow the film: Downlink (the link
 * rate while the film comes in, Locked once the rest of it is loaded, Hold while it buffers, Lost on an error), Audio,
 * Captions and Flight (Ready, Go, Hold, Complete). Decoration
 * (`aria-hidden`): each fact is already announced by the control or the status region that owns it.
 */
/**
 * The downlink: how fast the film is coming in, and whether there is anything left to load. The rate is the playback
 * engine's own bandwidth estimate (hls.js); engines that do not share one (the browser's own HLS, a plain file) give
 * no rate. `complete` is true once everything from the playhead to the end of the film is loaded.
 */
const readings = new WeakMap<HTMLMediaElement, { bps: number; at: number }>();

function downlink(media: HTMLMediaElement | null): { rate: string; complete: boolean; fresh: boolean } {
  if (!media) return { rate: '', complete: false, fresh: false };
  const duration = media.duration;
  let complete = false;
  if (Number.isFinite(duration) && duration > 0) {
    const ranges = media.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= media.currentTime + 0.5 && ranges.end(i) >= duration - 0.5) complete = true;
    }
  }
  const engine = (media as { engine?: { bandwidthEstimate?: number } | null }).engine;
  const bps = engine?.bandwidthEstimate;
  let rate = '';
  let fresh = false;
  if (typeof bps === 'number' && Number.isFinite(bps) && bps > 0) {
    const mbps = bps / 1e6;
    rate = `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mb/s`;
    // The estimate only moves when a piece of the film finishes loading; note when it last did.
    const now = performance.now();
    const last = readings.get(media);
    if (!last || last.bps !== bps) readings.set(media, { bps, at: now });
    fresh = now - (readings.get(media)?.at ?? now) < 2500;
  }
  return { rate, complete, fresh };
}

class AscentBoardElement extends UIElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #time = new PlayerController(this, playerContext, selectTime);
  #volume = new PlayerController(this, playerContext, selectVolume);
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #error = new PlayerController(this, playerContext, selectError);
  #cells: Record<string, HTMLElement> = {};
  #watch: MutationObserver | null = null;
  #poll = 0;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    if (!this.childElementCount) {
      for (const name of ['Downlink', 'Audio', 'Captions', 'Flight']) {
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
    // The downlink rate changes while the film is held or paused too, when nothing else asks for an update.
    clearInterval(this.#poll);
    this.#poll = window.setInterval(() => this.requestUpdate(), 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#watch?.disconnect();
    this.#watch = null;
    clearInterval(this.#poll);
  }

  #set(name: string, state: 'go' | 'hold' | 'wait' | 'off', text: string, quiet = false) {
    const cell = this.#cells[name];
    if (!cell) return;
    cell.dataset.s = state;
    // A reading that ticks (the downlink rate) changes in place; a change of word rises in.
    if (quiet && cell.dataset.r === 'rate') cell.lastElementChild!.textContent = text;
    else setWords(cell.lastElementChild!, text);
    cell.dataset.r = quiet ? 'rate' : '';
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
    // Downlink: Lost on an error, Hold while the film buffers, then the link rate while the film is still coming in,
    // and Locked once everything to the end of the film is loaded.
    const root = skinRoot(this);
    const link = downlink(root ? findMedia(root) : null);
    if (lost) this.#set('Downlink', 'hold', 'Lost');
    // During a hold, a rate measured before it would mislead: it shows only once a new reading comes in.
    else if (held) this.#set('Downlink', 'hold', link.fresh ? `HOLD · ${link.rate}` : 'Hold', link.fresh);
    else if (link.complete) this.#set('Downlink', 'go', 'Locked');
    else this.#set('Downlink', 'go', link.rate || 'Go', Boolean(link.rate));
    // Narrow players show the hold as a line under the title; it carries the rate too.
    const line = root?.querySelector('.asc-load span');
    if (line) line.textContent = `Hold · buffering${held && link.fresh ? ` · ${link.rate}` : ''}`;
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
    this.innerHTML = `<i class="asc-mh" aria-hidden="true">Next event</i><button type="button" class="asc-nx"><b><span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5zM18.5 5.5v13"/></svg></b><span class="lab"></span><span class="asc-tip" aria-hidden="true">Skip to it <kbd>N</kbd></span></button>`;
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
    this.#count.textContent = `T− ${clock((next ? next.startTime : duration) - (time?.currentTime ?? 0), Math.ceil)}`;
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
    this.#digits.textContent = remaining ? `−${clock(duration - current, Math.ceil)}` : clock(Math.min(current, duration));
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
 * light on each key to follow the pointer.
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

/** How long ignition lasts: the booster's flare, and the liftoff cloud rising and clearing. Matches skin.css. */
const IGNITION_MS = 3200;
/** After the launch effects end, the console stays up this long more, so the booster is seen burning on its own. */
const LAUNCH_HOLD_MS = 2000;

/**
 * <ascent-lift>: the idle behaviour. The HUD shows on pointer movement, a tap, a key, keyboard focus, or a pause.
 * Three seconds into playing without any of those, it lifts away and the path sinks to the bottom edge and fades out,
 * leaving only the film (and captions). With reduced motion the change is instant.
 *
 * It also calls the hold: while the film buffers (the `<media-buffering-indicator>` is showing) the skin carries
 * `data-hold`, the HUD stays up, the engine idles (or vents on the pad) and the Downlink lamp reads Hold. And it marks
 * ignition: `data-ignite` for a moment each time the film starts playing or a hold ends, which flares the engine.
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
  /** Until when (`performance.now()`) a launch is still worth watching: the console stays up till then. */
  #showUntil = 0;

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
      // The hold is over and the film is running: the engine lights again.
      if (!held && !this.#isPaused) this.#fire();
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
      if (this.#paused && !paused) this.#fire();
      this.#paused = paused;
      this.#wake();
    }
  }

  get #isPaused(): boolean {
    return this.#playback.value?.paused ?? true;
  }

  /** Ignition: marks the skin for as long as the launch effects run. */
  #fire() {
    if (reducedMotion()) return;
    const root = this.#root;
    if (!root) return;
    // Restart the effects if they are already running.
    root.removeAttribute('data-ignite');
    void root.offsetWidth;
    root.setAttribute('data-ignite', '');
    this.#showUntil = performance.now() + IGNITION_MS + LAUNCH_HOLD_MS;
    clearTimeout(this.#ignite);
    this.#ignite = window.setTimeout(() => root.removeAttribute('data-ignite'), IGNITION_MS);
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
    // In orbit (the credits are rolling): the console stays up so the craft can be seen circling.
    if (root.querySelector('ascent-flight[data-arrived]')) return;
    // A launch is playing out: let the smoke clear and the booster burn on its own for a moment first.
    const launch = this.#showUntil - performance.now();
    if (launch > 0) {
      clearTimeout(this.#timer);
      this.#timer = window.setTimeout(() => this.#sleep(checkHeld), launch);
      return;
    }
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

/**
 * <ascent-feed>: the tracking camera. While the pointer is over the flight path, or the path is dragged, a small
 * camera feed rides above the spot on the path that a press would seek to: the frame there (from the media's
 * `thumbnails` metadata track), the mission time and the event it falls in, with a stem down to a ring on the path.
 * It lives inside the time slider so its `<media-slider-thumbnail>` follows the slider's pointer. Without a
 * thumbnails track the feed still shows the time and the event.
 */
class AscentFeedElement extends PathElement {
  #card: HTMLElement | null = null;
  #time: HTMLElement | null = null;
  #event: HTMLElement | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#card = this.querySelector('.asc-feed-card');
    this.#time = this.querySelector('.asc-feed-t');
    this.#event = this.querySelector('.asc-feed-ev');
  }

  protected draw() {
    const slider = this.slider;
    const card = this.#card;
    if (!slider || !card) return;
    const { width: W, height: H } = this;
    const lift = this.lift?.value ?? 1;
    const duration = this.duration;
    const percent = parseFloat(slider.style.getPropertyValue('--media-slider-pointer'));
    const on =
      (slider.hasAttribute('data-pointing') || slider.hasAttribute('data-dragging')) &&
      lift > 0.6 &&
      duration > 0 &&
      Number.isFinite(percent);
    this.toggleAttribute('data-on', on);
    if (!on) return;

    const f = Math.min(1, Math.max(0, percent / 100));
    const g = geometry(W, H, lift);
    const x = pathX(g, f);
    const y = pathY(g, f);
    // The slider is positioned inside the skin root; this layer fills the slider.
    const ox = slider.offsetLeft;
    const oy = slider.offsetTop;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const edge = Math.max(10, W * 0.012);
    const cx = Math.min(W - edge - cw / 2, Math.max(edge + cw / 2, x));
    const gap = 22 * Math.max(0.8, sizeFor(W));
    // Keep the card below the header readouts; the stem shortens instead.
    const top = Math.max(W * 0.042 + 46, y - gap - ch);
    this.style.setProperty('--feed-x', `${(cx - ox).toFixed(1)}px`);
    this.style.setProperty('--feed-top', `${(top - oy).toFixed(1)}px`);
    this.style.setProperty('--pin-x', `${(x - ox).toFixed(1)}px`);
    this.style.setProperty('--pin-y', `${(y - oy).toFixed(1)}px`);
    this.style.setProperty('--stem', `${Math.max(0, y - (top + ch)).toFixed(1)}px`);

    const time = f * duration;
    const chapters = this.chapters;
    if (this.#time) this.#time.textContent = `T+ ${clock(time)}`;
    if (this.#event) this.#event.textContent = chapters.length ? chapters[chapterAt(chapters, time)].text : '';
  }
}

for (const [name, element] of [
  ['ascent-flight', AscentFlightElement],
  ['ascent-events', AscentEventsElement],
  ['ascent-feed', AscentFeedElement],
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
