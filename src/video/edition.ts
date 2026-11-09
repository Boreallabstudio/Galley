import { type Cue, loadVTT } from './vtt';

/**
 * One Edition per player container: the text of the media, read from the media's own `<track>` elements, and a clock
 * that follows playback frame by frame. Galley's elements share it, so the transcript, the caption line and the
 * figure caption all ink the same word on the same frame.
 *
 * Tracks the skin reads:
 * - captions or subtitles (the `default` one first): the text.
 * - chapters: section heads in the text and sections on the time slider.
 * - metadata labelled "galley" or "notes": notes set in the margin beside the words they belong to.
 */

type MediaLike = HTMLElement & {
  currentTime: number;
  duration: number;
  paused: boolean;
  readyState?: number;
};

export interface EditionText {
  cues: Cue[];
  chapters: Cue[];
  notes: Cue[];
}

type Listener = (time: number) => void;

const editions = new WeakMap<Element, Edition>();

export function editionFor(element: Element): Edition | null {
  const root = element.closest('media-container') ?? element.closest('video-player');
  if (!root) return null;
  let edition = editions.get(root);
  if (!edition) {
    edition = new Edition(root);
    editions.set(root, edition);
  }
  return edition;
}

function findMedia(root: Element): MediaLike | null {
  for (const element of root.querySelectorAll('*')) {
    if (element.localName.startsWith('media-') || element.localName.startsWith('galley-')) continue;
    if ('currentTime' in element && 'paused' in element && typeof (element as MediaLike & { play?: unknown }).play === 'function') {
      return element as MediaLike;
    }
  }
  return null;
}

/**
 * Galley sets the caption itself. A plain `<video>` is reached from skin.css, but media elements that keep their
 * `<video>` in a shadow root (`<mux-video>`, `<hls-video>`) draw cues where page styles cannot reach.
 */
function hideNativeCues(media: MediaLike) {
  const shadow = media.shadowRoot;
  if (!shadow || shadow.querySelector('style[data-galley]')) return;
  const style = document.createElement('style');
  style.dataset.galley = '';
  style.textContent =
    'video::-webkit-media-text-track-container{display:none}video::cue{color:transparent;background:transparent}';
  shadow.append(style);
}

function trackURL(track: HTMLTrackElement): string {
  return new URL(track.getAttribute('src') ?? '', document.baseURI).href;
}

export class Edition {
  readonly root: Element;
  media: MediaLike | null = null;
  text: Promise<EditionText>;

  #listeners = new Set<Listener>();
  #frame = 0;
  #last = -1;
  #resolveText!: (value: EditionText) => void;

  constructor(root: Element) {
    this.root = root;
    this.text = new Promise((resolve) => (this.#resolveText = resolve));
    this.#attach(0);
  }

  get time(): number {
    return this.media?.currentTime ?? 0;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    if (this.#last >= 0) listener(this.#last);
    return () => this.#listeners.delete(listener);
  }

  /** Find the media once the template has mounted. Custom media elements may upgrade a frame or two later. */
  #attach(attempt: number) {
    const media = findMedia(this.root);
    if (!media) {
      if (attempt < 120) requestAnimationFrame(() => this.#attach(attempt + 1));
      else this.#resolveText({ cues: [], chapters: [], notes: [] });
      return;
    }
    this.media = media;
    hideNativeCues(media);
    void this.#readTracks(media);

    const tick = () => this.#emit();
    const run = () => {
      cancelAnimationFrame(this.#frame);
      const loop = () => {
        this.#emit();
        if (!media.paused) this.#frame = requestAnimationFrame(loop);
      };
      this.#frame = requestAnimationFrame(loop);
    };
    media.addEventListener('play', run);
    media.addEventListener('playing', run);
    for (const type of ['pause', 'seeking', 'seeked', 'timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) {
      media.addEventListener(type, tick);
    }
    tick();
  }

  async #readTracks(media: MediaLike) {
    const tracks = [...media.querySelectorAll<HTMLTrackElement>('track[src]')];
    const textTracks = tracks.filter((track) => /^(captions|subtitles)$/.test(track.kind || 'subtitles'));
    const text = textTracks.find((track) => track.default) ?? textTracks[0];
    const chapters = tracks.find((track) => track.kind === 'chapters');
    const notes = tracks.find((track) => track.kind === 'metadata' && /^(galley|notes)$/i.test(track.label));

    const read = (track?: HTMLTrackElement) => (track ? loadVTT(trackURL(track)).catch(() => []) : Promise.resolve([]));
    const [cues, chapterCues, noteCues] = await Promise.all([read(text), read(chapters), read(notes)]);
    this.#resolveText({ cues, chapters: chapterCues, notes: noteCues });
  }

  #emit() {
    const time = this.time;
    this.#last = time;
    for (const listener of this.#listeners) listener(time);
  }
}

/** Index of the last item whose start is at or before `time`, or -1. */
export function indexAt(items: { start: number }[], time: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (items[mid].start <= time + 0.001) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * Clock time, written the way Video.js writes the player's own time: minutes take two digits once the media runs
 * ten minutes or longer, so the folio, the hint and the foot all read alike.
 */
export function formatTime(seconds: number, length = seconds): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  if (h || length >= 3600) return `${h}:${String(m).padStart(2, '0')}:${s}`;
  return `${length >= 600 ? String(m).padStart(2, '0') : m}:${s}`;
}

export function roman(value: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = value;
  let out = '';
  for (const [n, glyph] of table) {
    while (rest >= n) {
      out += glyph;
      rest -= n;
    }
  }
  return out;
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
