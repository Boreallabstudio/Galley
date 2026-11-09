import '@videojs/html/video/player';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: John F. Kennedy at Rice University, 12 September 1962 (public domain), with a word-timed
// transcript, chapters and margin notes as ordinary WebVTT tracks.
const SRC = './media/rice-1962.mp4';
const POSTER = './media/rice-1962-poster.jpg';
const TITLE = 'We choose to go to the Moon';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  player.setAttribute('poster', POSTER);
  player.setAttribute('content-title', TITLE);

  player.innerHTML = skinTemplate.replace(
    MEDIA_PLACEHOLDER,
    `<video src="${SRC}" playsinline preload="metadata">
      <track kind="captions" label="English" srclang="en" src="./media/rice-1962-en.vtt">
      <track kind="chapters" label="English" srclang="en" src="./media/rice-1962-chapters.vtt" default>
      <track kind="metadata" label="galley" srclang="en" src="./media/rice-1962-notes.vtt">
    </video>`
  );

  const skin = player.querySelector<HTMLElement>('.gl');
  skin?.style.setProperty('--gl-plate-ratio', '4 / 3');

  return player;
}
