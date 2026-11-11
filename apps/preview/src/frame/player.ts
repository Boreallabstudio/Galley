import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: Charge by Blender Studio (CC BY 4.0), shortened to its break-in, surge and escape, streamed from Mux by its public
// playback ID. Chapters and captions are ordinary WebVTT tracks served with the workbench.
const MUX_PLAYBACK_ID = 'OK1o7egX5oZAnzKojhYQzw27iHWgjzeklXodi8xDUy4';
const TITLE = 'Charge';
const BYLINE = 'Blender Studio · 2022';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  player.setAttribute('content-title', TITLE);

  player.innerHTML = skinTemplate.replace(
    MEDIA_PLACEHOLDER,
    `<mux-video playsinline preload="metadata" crossorigin="anonymous">
      <track kind="chapters" label="Events" srclang="en" src="./media/charge-chapters.vtt" default>
      <track kind="captions" label="English" srclang="en" src="./media/charge-captions.vtt" default>
    </mux-video>`
  );

  // The structured source builds the stream URL from the playback ID; <mux-video> also derives the poster from it
  // (a frame at 9.5 s) and hands it to the skin.
  const media = player.querySelector('mux-video');
  if (media) media.source = { playbackId: MUX_PLAYBACK_ID, poster: { time: 9.5 } };

  const byline = player.querySelector<HTMLElement>('[data-asc-byline]');
  if (byline) byline.textContent = BYLINE;

  return player;
}
