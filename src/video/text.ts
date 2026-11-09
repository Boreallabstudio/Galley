import {
  PlayerController,
  playerContext,
  selectPlayback,
  selectTextTrack,
  selectTime,
  type PropertyValues,
  UIElement,
} from '@videojs/html';

import { type Edition, editionFor, formatTime, indexAt, prefersReducedMotion, roman } from './edition';
import type { Cue } from './vtt';
import { paragraphsOf } from './vtt';

/**
 * <galley-text>: the transcript, set as a page, is the player's main seek control.
 *
 * Words already spoken are inked; words still to come wait in a lighter grey; a pencil rule runs under the line being
 * spoken, word by word. Choosing any word jumps there. Keyboard users move between lines with the arrow keys and
 * choose one with Enter or Space; the transcript keeps a single tab stop.
 */

interface LineRecord {
  cue: Cue;
  element: HTMLElement;
  words: HTMLElement[];
}

interface NoteRecord {
  cue: Cue;
  element: HTMLElement;
}

const FOLLOW_ANCHOR = 0.32;

class GalleyTextElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);

  #edition: Edition | null = null;
  #unsubscribe: (() => void) | null = null;
  #abort: AbortController | null = null;

  #scroller!: HTMLElement;
  #content!: HTMLElement;
  #hint!: HTMLElement;
  #return!: HTMLButtonElement;
  #returnTime!: HTMLElement;

  #lines: LineRecord[] = [];
  #cuesEnd = 0;
  #notes: NoteRecord[] = [];
  #current = -2;
  #currentWord = -1;
  #activeNotes = new Set<NoteRecord>();
  #following = true;
  #programmaticScroll = 0;
  #built = false;

  connectedCallback() {
    super.connectedCallback();
    this.#abort?.abort();
    this.#abort = new AbortController();

    if (!this.#built) this.#buildShell();
    this.#edition = editionFor(this);
    const edition = this.#edition;
    if (!edition) return;

    void edition.text.then(({ cues, chapters, notes }) => {
      if (!this.isConnected) return;
      this.#render(cues, chapters, notes);
      this.#unsubscribe?.();
      this.#unsubscribe = edition.subscribe((time) => this.#update(time));
    });

    this.#listen(this.#abort.signal);

    // [ and ] step back and forward a sentence from anywhere in the player.
    const container = this.closest('media-container');
    container?.addEventListener(
      'keydown',
      (event) => {
        const key = (event as KeyboardEvent).key;
        const target = event.target as HTMLElement;
        if ((key !== '[' && key !== ']') || target.closest('input, textarea, select, [contenteditable]')) return;
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) return;
        event.preventDefault();
        this.#step(key === ']' ? 1 : -1);
      },
      { signal: this.#abort.signal }
    );
  }

  /** Jump to the next or previous sentence. Going back first returns to the start of the current one. */
  #step(delta: 1 | -1) {
    if (!this.#lines.length) return;
    const time = this.#edition?.time ?? 0;
    const current = Math.max(0, this.#current);
    let target = current + delta;
    if (delta < 0 && time - this.#lines[current].cue.start > 2) target = current;
    target = Math.min(this.#lines.length - 1, Math.max(0, target));
    this.#jump(this.#lines[target].cue.start);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #buildShell() {
    this.#built = true;
    this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', this.getAttribute('label') ?? 'Transcript');

    this.#scroller = document.createElement('div');
    this.#scroller.className = 'gl-scroller';
    this.#scroller.setAttribute('part', 'scroller');

    this.#content = document.createElement('div');
    this.#content.className = 'gl-content';
    this.#content.setAttribute('aria-busy', 'true');
    this.#content.innerHTML = '<p class="gl-loading">Setting the text…</p>';

    this.#hint = document.createElement('span');
    this.#hint.className = 'gl-hint';
    this.#hint.setAttribute('aria-hidden', 'true');

    this.#return = document.createElement('button');
    this.#return.type = 'button';
    this.#return.className = 'gl-return';
    this.#return.hidden = true;
    this.#return.innerHTML = '<span class="gl-return-label">Back to the reading</span> <span class="gl-return-time"></span>';
    this.#returnTime = this.#return.querySelector('.gl-return-time')!;

    this.#scroller.append(this.#content);
    this.append(this.#scroller, this.#return);
  }

  #render(cues: Cue[], chapters: Cue[], notes: Cue[]) {
    const content = this.#content;
    content.replaceChildren();
    content.removeAttribute('aria-busy');
    this.#lines = [];
    this.#notes = [];
    this.#current = -2;

    // Without captions there is nothing to set, so the player closes up to the picture alone.
    this.closest('.gl')?.toggleAttribute('data-no-text', !cues.length);
    if (!cues.length) {
      content.innerHTML = '';
      return;
    }

    let chapterIndex = 0;
    let noteIndex = 0;
    this.#cuesEnd = cues.length ? cues[cues.length - 1].end : 0;
    const paragraphs = paragraphsOf(cues);

    paragraphs.forEach((paragraph, paragraphIndex) => {
      // Section heads come from the chapters track, placed before the paragraph where their chapter begins.
      while (chapterIndex < chapters.length && chapters[chapterIndex].start <= paragraph[0].start + 0.5) {
        const head = document.createElement('h3');
        head.className = 'gl-head';
        head.dataset.start = String(chapters[chapterIndex].start);
        head.innerHTML = `<span class="gl-head-number">${roman(chapterIndex + 1)}</span> <span class="gl-head-title"></span>`;
        head.querySelector('.gl-head-title')!.textContent = chapters[chapterIndex].text;
        content.append(head);
        chapterIndex++;
      }

      const row = document.createElement('div');
      row.className = 'gl-row';
      if (paragraphIndex === 0) row.classList.add('gl-row-first');

      const folio = document.createElement('span');
      folio.className = 'gl-folio';
      folio.setAttribute('aria-hidden', 'true');
      folio.textContent = formatTime(paragraph[0].start, this.#length());

      const p = document.createElement('p');
      p.className = 'gl-para';

      const paragraphEnd = paragraph[paragraph.length - 1].end;
      const nextStart = paragraphs[paragraphIndex + 1]?.[0].start ?? Number.POSITIVE_INFINITY;
      const rowNotes: Cue[] = [];
      while (noteIndex < notes.length && notes[noteIndex].start < Math.max(paragraphEnd, nextStart - 0.01)) {
        rowNotes.push(notes[noteIndex]);
        noteIndex++;
      }

      for (const cue of paragraph) {
        const line = document.createElement('span');
        line.className = 'gl-line';
        line.setAttribute('role', 'button');
        line.tabIndex = this.#lines.length === 0 ? 0 : -1;
        line.dataset.index = String(this.#lines.length);

        const words = cue.words.map((word, wordIndex) => {
          const span = document.createElement('span');
          span.className = 'gl-word';
          span.dataset.word = String(wordIndex);
          span.textContent = `${word.text} `;
          line.append(span);
          return span;
        });

        // A reference mark after the word being spoken when each note begins.
        for (const note of rowNotes) {
          if (note.start < cue.start || note.start >= cue.end + 0.01) continue;
          const at = Math.max(0, indexAt(cue.words, note.start));
          const mark = document.createElement('sup');
          mark.className = 'gl-mark';
          mark.setAttribute('aria-hidden', 'true');
          mark.textContent = String(this.#notes.length + rowNotes.indexOf(note) + 1);
          words[at]?.append(mark);
        }

        p.append(line);
        this.#lines.push({ cue, element: line, words });
      }

      const margin = document.createElement('div');
      margin.className = 'gl-margin';
      for (const note of rowNotes) {
        const aside = document.createElement('aside');
        aside.className = 'gl-note';
        const number = this.#notes.length + 1;
        aside.innerHTML = `<span class="gl-note-number" aria-hidden="true">${number}</span><span class="gl-note-text"></span>`;
        aside.querySelector('.gl-note-text')!.textContent = note.text;
        aside.setAttribute('aria-label', `Note ${number}: ${note.text}`);
        margin.append(aside);
        this.#notes.push({ cue: note, element: aside });
      }

      row.append(folio, p, margin);
      content.append(row);
    });

    content.append(this.#hint);
    const edition = this.#edition;
    if (edition) this.#update(edition.time);
  }

  #listen(signal: AbortSignal) {
    const scroller = this.#scroller;

    this.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.gl-return')) {
          this.#follow(true);
          return;
        }
        const line = target.closest<HTMLElement>('.gl-line');
        if (!line) return;
        const record = this.#lines[Number(line.dataset.index)];
        const word = target.closest<HTMLElement>('.gl-word');
        const wordIndex = word ? Number(word.dataset.word) : 0;
        this.#jump(record.cue.words[wordIndex]?.start ?? record.cue.start);
        // A pointer choice hands focus back to the player, so Space still plays and pauses.
        // Keyboard activation keeps focus on the line the reader chose.
        if (event.detail > 0) this.#focusPlayer();
      },
      { signal }
    );

    this.addEventListener(
      'mousedown',
      (event) => {
        if ((event.target as HTMLElement).closest('.gl-line') && event.detail > 1) event.preventDefault();
      },
      { signal }
    );
    this.addEventListener('keydown', (event) => this.#onKeydown(event), { signal });
    this.addEventListener('keyup', (event) => this.#onKeyup(event), { signal });

    // Hovering a word shows its time in the gutter: every word has an address.
    this.addEventListener(
      'pointerover',
      (event) => {
        const word = (event.target as HTMLElement).closest<HTMLElement>('.gl-word');
        if (!word || event.pointerType === 'touch') return;
        const line = word.closest<HTMLElement>('.gl-line');
        if (!line) return;
        const cue = this.#lines[Number(line.dataset.index)]?.cue;
        const time = cue?.words[Number(word.dataset.word)]?.start;
        if (time == null) return;
        this.#hint.textContent = formatTime(time, this.#length());
        this.#hint.style.setProperty('--gl-hint-top', `${word.offsetTop}px`);
        this.#hint.dataset.visible = '';
      },
      { signal }
    );
    this.addEventListener('pointerleave', () => delete this.#hint.dataset.visible, { signal });
    this.#content.addEventListener(
      'pointerout',
      (event) => {
        if (!(event.relatedTarget as HTMLElement | null)?.closest?.('.gl-word')) delete this.#hint.dataset.visible;
      },
      { signal }
    );

    // Reading ahead or back stops the page from following playback, until the reader returns.
    const release = () => {
      if (performance.now() - this.#programmaticScroll > 120) this.#follow(false);
    };
    scroller.addEventListener('wheel', release, { signal, passive: true });
    scroller.addEventListener('touchmove', release, { signal, passive: true });
    scroller.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target === scroller) release();
      },
      { signal }
    );
    scroller.addEventListener(
      'scroll',
      () => {
        if (performance.now() - this.#programmaticScroll < 900) return;
        if (!this.#following) this.#updateReturn();
      },
      { signal, passive: true }
    );
  }

  #onKeydown(event: KeyboardEvent) {
    const line = (event.target as HTMLElement).closest<HTMLElement>('.gl-line');
    if (!line) return;
    const index = Number(line.dataset.index);
    let next: number | null = null;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = Math.min(this.#lines.length - 1, index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = Math.max(0, index - 1);
        break;
      case 'PageDown':
        next = Math.min(this.#lines.length - 1, index + 8);
        break;
      case 'PageUp':
        next = Math.max(0, index - 8);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.#lines.length - 1;
        break;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        this.#jump(this.#lines[index].cue.start);
        return;
      case ' ':
        // ARIA button pattern: Space activates on key up. Stop the player's Space shortcut from also firing.
        event.preventDefault();
        event.stopPropagation();
        return;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.#focusLine(next, true);
  }

  #onKeyup(event: KeyboardEvent) {
    if (event.key !== ' ') return;
    const line = (event.target as HTMLElement).closest<HTMLElement>('.gl-line');
    if (!line) return;
    event.preventDefault();
    event.stopPropagation();
    this.#jump(this.#lines[Number(line.dataset.index)].cue.start);
  }

  #focusPlayer() {
    const container = this.closest<HTMLElement>('media-container');
    if (!container) return;
    if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
    container.focus({ preventScroll: true });
  }

  #focusLine(index: number, focus: boolean) {
    for (const record of this.#lines) if (record.element.tabIndex === 0) record.element.tabIndex = -1;
    const record = this.#lines[index];
    if (!record) return;
    record.element.tabIndex = 0;
    if (focus) {
      record.element.focus({ preventScroll: true });
      this.#scrollTo(record.element, 'nearest');
    }
  }

  #jump(time: number) {
    const timeState = this.#time.value;
    const playback = this.#playback.value;
    if (!timeState) return;
    timeState.seek(time + 0.01);
    this.#follow(true);
    if (playback?.paused) Promise.resolve(playback.play()).catch(() => {});
  }

  #follow(on: boolean) {
    this.#following = on;
    if (on) {
      this.#return.hidden = true;
      const record = this.#lines[Math.max(0, this.#current)];
      if (record) this.#scrollTo(record.element, 'anchor');
    } else this.#updateReturn();
  }

  #updateReturn() {
    const record = this.#lines[Math.max(0, this.#current)];
    if (!record) return;
    const scroller = this.#scroller.getBoundingClientRect();
    const line = record.element.getBoundingClientRect();
    const visible = line.bottom > scroller.top + 8 && line.top < scroller.bottom - 8;
    this.#return.hidden = visible;
    this.#return.dataset.direction = line.top < scroller.top ? 'up' : 'down';
    this.#returnTime.textContent = formatTime(this.#edition?.time ?? record.cue.start, this.#length());
    if (visible) this.#following = true;
  }

  #scrollTo(element: HTMLElement, mode: 'anchor' | 'nearest') {
    const scroller = this.#scroller;
    const top = element.offsetTop;
    const height = scroller.clientHeight;
    let target: number;
    if (mode === 'anchor') target = top - height * FOLLOW_ANCHOR;
    else {
      const current = scroller.scrollTop;
      if (top < current + 24) target = top - 24;
      else if (top + element.offsetHeight > current + height - 24) target = top + element.offsetHeight - height + 24;
      else return;
    }
    this.#programmaticScroll = performance.now();
    scroller.scrollTo({ top: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /** How long the media runs: its duration once known, otherwise the end of the last caption. */
  #length(): number {
    const duration = this.#edition?.media?.duration;
    if (duration && Number.isFinite(duration)) return duration;
    return this.#cuesEnd;
  }

  #update(time: number) {
    const lines = this.#lines;
    if (!lines.length) return;

    const index = indexAt(
      lines.map((record) => record.cue),
      time
    );

    if (index !== this.#current) {
      const previous = this.#current;
      const low = Math.max(0, Math.min(previous, index));
      const high = Math.max(previous, index);
      const range = previous < -1 ? [0, lines.length - 1] : [low, high];
      for (let i = range[0]; i <= range[1]; i++) {
        const element = lines[i].element;
        element.classList.toggle('is-past', i < index);
        element.classList.toggle('is-current', i === index);
        if (i === index) element.setAttribute('aria-current', 'true');
        else element.removeAttribute('aria-current');
        if (i !== index) for (const word of lines[i].words) word.classList.remove('is-said', 'is-saying');
      }
      this.#current = index;
      this.#currentWord = -1;

      const focusInside = this.contains(document.activeElement);
      if (!focusInside) this.#focusLine(Math.max(index, 0), false);

      if (this.#following && index >= 0) this.#scrollTo(lines[index].element, 'anchor');
      else if (!this.#following) this.#updateReturn();
    }

    const record = lines[index];
    if (record) {
      const words = record.cue.words;
      const wordIndex = indexAt(words, time);
      if (wordIndex !== this.#currentWord) {
        record.words.forEach((element, i) => {
          element.classList.toggle('is-said', i < wordIndex);
          element.classList.toggle('is-saying', i === wordIndex);
        });
        this.#currentWord = wordIndex;
      }
      const word = words[wordIndex];
      if (word) {
        const progress = Math.min(1, Math.max(0, (time - word.start) / Math.max(0.05, word.end - word.start)));
        record.words[wordIndex].style.setProperty('--gl-progress', progress.toFixed(3));
      }
    }

    for (const note of this.#notes) {
      const active = time >= note.cue.start && time < note.cue.end;
      if (active === this.#activeNotes.has(note)) continue;
      note.element.classList.toggle('is-active', active);
      if (active) this.#activeNotes.add(note);
      else this.#activeNotes.delete(note);
    }
  }
}

/**
 * <galley-line>: the line being spoken, set over the picture. Shown when captions are on and the page layout has
 * no room for the full text beside the picture.
 */
class GalleyLineElement extends UIElement {
  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #unsubscribe: (() => void) | null = null;
  #cues: Cue[] = [];
  #current = -2;
  #currentWord = -1;
  #words: HTMLElement[] = [];
  #text!: HTMLElement;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    if (!this.#text) {
      this.#text = document.createElement('span');
      this.#text.className = 'gl-line-text';
      this.append(this.#text);
    }
    const edition = editionFor(this);
    if (!edition) return;
    void edition.text.then(({ cues }) => {
      if (!this.isConnected) return;
      this.#cues = cues;
      this.#unsubscribe?.();
      this.#unsubscribe = edition.subscribe((time) => this.#update(time));
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  update(changed: PropertyValues) {
    super.update(changed);
    const tracks = this.#tracks.value;
    this.toggleAttribute('data-showing', Boolean(tracks?.subtitlesShowing));
  }

  #update(time: number) {
    const index = indexAt(this.#cues, time);
    const cue = this.#cues[index];
    const live = cue && time < cue.end + 0.6;
    this.toggleAttribute('data-empty', !live);
    if (!live) return;

    if (index !== this.#current) {
      this.#current = index;
      this.#currentWord = -1;
      this.#words = cue.words.map((word) => {
        const span = document.createElement('span');
        span.className = 'gl-word';
        span.textContent = `${word.text} `;
        return span;
      });
      this.#text.replaceChildren(...this.#words);
    }
    const wordIndex = indexAt(cue.words, time);
    if (wordIndex !== this.#currentWord) {
      this.#words.forEach((element, i) => element.classList.toggle('is-said', i <= wordIndex));
      this.#currentWord = wordIndex;
    }
  }
}


/**
 * <galley-peek>: inside the time slider's preview, shows the sentence spoken at the pointer (or at the focused
 * playhead for keyboard users). The seek rule is a sentence you can read before you land on it.
 */
class GalleyPeekElement extends UIElement {
  #cues: Cue[] = [];
  #abort: AbortController | null = null;
  #slider: HTMLElement | null = null;
  #edition: Edition | null = null;
  #unsubscribe: (() => void) | null = null;
  #shown = -2;

  connectedCallback() {
    super.connectedCallback();
    this.#abort?.abort();
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    this.#slider = this.closest<HTMLElement>('media-time-slider');
    this.#edition = editionFor(this);
    if (!this.#slider || !this.#edition) return;

    void this.#edition.text.then(({ cues }) => {
      if (this.isConnected) this.#cues = cues;
    });

    // The slider writes where the pointer is (mouse, touch or drag) into --media-slider-pointer on its own style.
    const slider = this.#slider;
    const update = () => {
      const duration = this.#edition?.media?.duration;
      if (!duration || !Number.isFinite(duration)) return;
      let percent = Number.NaN;
      if (slider.hasAttribute('data-pointing') || slider.hasAttribute('data-dragging')) {
        percent = parseFloat(slider.style.getPropertyValue('--media-slider-pointer'));
        if (Number.isFinite(percent)) this.#show((Math.min(Math.max(percent, 0), 100) / 100) * duration);
      } else if (slider.matches(':focus-within')) {
        percent = (this.#edition!.time / duration) * 100;
        this.#show(this.#edition!.time);
      }
      if (Number.isFinite(percent)) this.#place(percent);
    };
    const observer = new MutationObserver(update);
    observer.observe(slider, { attributes: true, attributeFilter: ['style', 'data-pointing', 'data-dragging'] });
    signal.addEventListener('abort', () => observer.disconnect());

    // Keyboard users: while the slider has focus the card follows the playhead.
    slider.addEventListener(
      'focusin',
      () => {
        this.#unsubscribe?.();
        this.#unsubscribe = this.#edition!.subscribe(update);
      },
      { signal }
    );
    slider.addEventListener('focusout', () => this.#unsubscribe?.(), { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
    this.#unsubscribe?.();
  }

  #show(time: number) {
    const index = indexAt(this.#cues, time);
    if (index === this.#shown) return;
    this.#shown = index;
    const cue = this.#cues[index];
    this.textContent = cue ? cue.text : '';
    this.toggleAttribute('data-empty', !cue);
  }

  /**
   * Centre the card over the point it describes, kept inside the whole foot rather than the rule alone: on a phone
   * the rule shares its row with the time, and is narrower than the card.
   */
  #place(percent: number) {
    const card = this.parentElement;
    const slider = this.#slider;
    const foot = slider?.closest<HTMLElement>('.gl-foot') ?? slider?.parentElement;
    if (!card || !slider || !foot) return;
    requestAnimationFrame(() => {
      const s = slider.getBoundingClientRect();
      const f = foot.getBoundingClientRect();
      const width = card.offsetWidth;
      const rtl = getComputedStyle(slider).direction === 'rtl';
      const at = ((rtl ? 100 - percent : percent) / 100) * s.width;
      const left = Math.min(Math.max(at - width / 2, f.left - s.left), f.right - s.left - width);
      card.style.setProperty('--gl-card-left', `${Math.round(left)}px`);
    });
  }
}

/** <galley-chapter>: the title of the chapter playing now, for the figure caption. */
class GalleyChapterElement extends UIElement {
  #unsubscribe: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    const edition = editionFor(this);
    if (!edition) return;
    void edition.text.then(({ chapters }) => {
      if (!this.isConnected) return;
      let current = -2;
      this.toggleAttribute('hidden', !chapters.length);
      this.#unsubscribe?.();
      this.#unsubscribe = edition.subscribe((time) => {
        const index = Math.max(0, indexAt(chapters, time));
        if (index === current || !chapters[index]) return;
        current = index;
        this.innerHTML = `<span class="gl-chapter-number">${roman(index + 1)}</span> <span class="gl-chapter-title"></span>`;
        this.querySelector('.gl-chapter-title')!.textContent = chapters[index].text;
      });
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}

/** <galley-plate>: the picture. Clicking it plays or pauses, the way a reader taps a figure. */
class GalleyPlateElement extends UIElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #abort: AbortController | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.#abort?.abort();
    this.#abort = new AbortController();
    this.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, [role="button"], media-error-dialog, a, input')) return;
        const playback = this.#playback.value;
        if (!playback) return;
        if (playback.paused) Promise.resolve(playback.play()).catch(() => {});
        else playback.pause();
      },
      { signal: this.#abort.signal }
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
  }

  update(changed: PropertyValues) {
    super.update(changed);
    const playback = this.#playback.value;
    this.toggleAttribute('data-paused', playback ? playback.paused : true);
    this.toggleAttribute('data-started', Boolean(playback && (!playback.paused || playback.started)));
  }
}

for (const [name, element] of [
  ['galley-text', GalleyTextElement],
  ['galley-line', GalleyLineElement],
  ['galley-chapter', GalleyChapterElement],
  ['galley-peek', GalleyPeekElement],
  ['galley-plate', GalleyPlateElement],
] as const) {
  if (!customElements.get(name)) customElements.define(name, element);
}
