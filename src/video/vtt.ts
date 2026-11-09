/**
 * A small WebVTT reader for Galley.
 *
 * The browser parses tracks too, but it hides the cues of a disabled track and keeps no paragraph or word structure.
 * Galley reads the same files the media element uses, so captions, chapters and notes stay ordinary WebVTT:
 *
 * - Word timing comes from WebVTT's own inline timestamps (`<00:01:02.500>word`). Cues without them get word times
 *   spread across the cue by word length.
 * - A cue whose identifier starts with `¶` begins a new paragraph. Without those marks, a pause longer than
 *   `PARAGRAPH_GAP` seconds starts one.
 */

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: Word[];
}

const TIMESTAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;
const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)/;
const INLINE_TIME = /<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})>/g;
/** A token that continues the word before it: digit groups (",400", ".5") and hyphenated parts ("-1"). */
const JOINS = /^(?:[,.]\d|-[\p{L}\p{N}])/u;

/** The same rule for a cue's plain text. */
function joinSplitWords(text: string): string {
  return text.replace(/([\p{L}\p{N}]) (?=[,.]\d|-[\p{L}\p{N}])/gu, '$1');
}

export function parseTimestamp(value: string): number {
  const match = TIMESTAMP.exec(value);
  if (!match) return Number.NaN;
  const [, h = '0', m, s, ms] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/** Strip WebVTT markup such as `<i>`, `<v Speaker>` and `<c.class>`, and decode the few entities WebVTT allows. */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lrm;|&rlm;/g, '');
}

/** Words of a cue, with times from inline timestamps where the cue has them. */
function wordsOf(body: string, start: number, end: number): Word[] {
  const pieces: { text: string; at: number | null }[] = [];
  let at: number | null = start;
  let last = 0;

  const push = (chunk: string) => {
    for (const token of plainText(chunk).split(/\s+/)) {
      if (!token) continue;
      // Speech-to-text often splits numbers and compounds ("5 ,400", "C -1"): set them back as one word.
      const previous = pieces[pieces.length - 1];
      if (previous && JOINS.test(token) && /[\p{L}\p{N}]$/u.test(previous.text)) {
        previous.text += token;
        at = null;
        continue;
      }
      pieces.push({ text: token, at });
      at = null;
    }
  };

  INLINE_TIME.lastIndex = 0;
  for (let match = INLINE_TIME.exec(body); match; match = INLINE_TIME.exec(body)) {
    push(body.slice(last, match.index));
    at = parseTimestamp(match[1]);
    last = match.index + match[0].length;
  }
  push(body.slice(last));

  // Fill untimed words between known times, weighted by length so long words take longer to say.
  const words: Word[] = pieces.map((piece) => ({ text: piece.text, start: piece.at ?? Number.NaN, end: Number.NaN }));
  let i = 0;
  while (i < words.length) {
    const from = i;
    const t0 = Number.isNaN(words[i].start) ? start : words[i].start;
    let j = i + 1;
    while (j < words.length && Number.isNaN(words[j].start)) j++;
    const t1 = j < words.length ? words[j].start : end;
    const weights = words.slice(from, j).map((word) => word.text.length + 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let t = t0;
    for (let k = from; k < j; k++) {
      words[k].start = t;
      t += ((t1 - t0) * weights[k - from]) / total;
      words[k].end = t;
    }
    i = j;
  }
  for (let k = 0; k < words.length - 1; k++) words[k].end = Math.min(words[k].end, words[k + 1].start);
  return words;
}

export function parseVTT(source: string): Cue[] {
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line, index) => index > 0 || line.trim() !== '');
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;

    const timingIndex = TIMING_LINE.test(lines[0]) ? 0 : 1;
    const timing = TIMING_LINE.exec(lines[timingIndex] ?? '');
    if (!timing) continue;

    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    const body = lines.slice(timingIndex + 1).join('\n');

    cues.push({
      id: timingIndex === 1 ? lines[0].trim() : '',
      start,
      end,
      text: joinSplitWords(plainText(body.replace(INLINE_TIME, '')).replace(/\s+/g, ' ').trim()),
      words: wordsOf(body, start, end),
    });
  }

  return cues.sort((a, b) => a.start - b.start);
}

/** Group caption cues into paragraphs. */
export const PARAGRAPH_GAP = 1.6;

export function paragraphsOf(cues: Cue[]): Cue[][] {
  const marked = cues.some((cue) => cue.id.startsWith('¶'));
  const paragraphs: Cue[][] = [];

  cues.forEach((cue, index) => {
    const previous = cues[index - 1];
    const starts = marked ? cue.id.startsWith('¶') : !previous || cue.start - previous.end > PARAGRAPH_GAP;
    if (starts || !paragraphs.length) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(cue);
  });

  return paragraphs;
}

const cache = new Map<string, Promise<Cue[]>>();

export function loadVTT(url: string): Promise<Cue[]> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        return response.text();
      })
      .then(parseVTT)
      .catch((error) => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, pending);
  }
  return pending;
}
