import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: Charge by Blender Studio (CC BY 4.0), shortened to its approach, surge and walk home, streamed from Mux by its public
// playback ID. Chapters and captions are ordinary WebVTT tracks served with the workbench.
const MUX_PLAYBACK_ID = 'kTBu01nh00xnHk00v6o7s900vpfxFKeM028Be6dOeph2rS0000';
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
      <track kind="metadata" label="thumbnails" src="https://image.mux.com/${MUX_PLAYBACK_ID}/storyboard.vtt" default>
    </mux-video>`
  );

  // The structured source builds the stream URL from the playback ID; <mux-video> also derives the poster from it
  // (a frame at 16 s) and hands it to the skin.
  const media = player.querySelector('mux-video');
  if (media) media.source = { playbackId: MUX_PLAYBACK_ID, poster: { time: 16 } };

  const byline = player.querySelector<HTMLElement>('[data-asc-byline]');
  if (byline) byline.textContent = BYLINE;

  return player;
}
