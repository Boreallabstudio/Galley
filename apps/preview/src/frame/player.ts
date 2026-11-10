import '@videojs/html/video/player';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: Spring by Blender Studio (CC BY 4.0), cropped to 16:9, with chapters and captions as
// ordinary WebVTT tracks. A plain <video> for now.
const SRC = './spring-720-16x9.mp4';
const POSTER = './media/spring-poster.jpg';
const TITLE = 'Spring';
const BYLINE = 'Blender Studio · 2019';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  player.setAttribute('poster', POSTER);
  player.setAttribute('content-title', TITLE);

  player.innerHTML = skinTemplate.replace(
    MEDIA_PLACEHOLDER,
    `<video src="${SRC}" playsinline preload="metadata">
      <track kind="chapters" label="Events" srclang="en" src="./media/spring-chapters.vtt" default>
      <track kind="captions" label="English" srclang="en" src="./media/spring-captions.vtt" default>
    </video>`
  );

  const byline = player.querySelector<HTMLElement>('[data-asc-byline]');
  if (byline) byline.textContent = BYLINE;

  return player;
}
