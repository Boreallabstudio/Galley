import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays: Wing It! by Blender Studio (CC BY 4.0), shortened to its launch and landing, streamed from Mux by its public
// playback ID. Chapters and captions are ordinary WebVTT tracks served with the workbench.
const MUX_PLAYBACK_ID = 'oD900nfJsk4MqnraSb3qcSA7toKx02CkdLVos00nKgpX4M';
const TITLE = 'Wing It!';
const BYLINE = 'Blender Studio · 2023';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  player.setAttribute('content-title', TITLE);

  player.innerHTML = skinTemplate.replace(
    MEDIA_PLACEHOLDER,
    `<mux-video playsinline preload="metadata" crossorigin="anonymous">
      <track kind="chapters" label="Events" srclang="en" src="./media/wing-it-chapters.vtt" default>
      <track kind="captions" label="English" srclang="en" src="./media/wing-it-captions.vtt" default>
    </mux-video>`
  );

  // The structured source builds the stream URL from the playback ID; <mux-video> also derives the poster from it
  // (a frame at 30 s) and hands it to the skin.
  const media = player.querySelector('mux-video');
  if (media) media.source = { playbackId: MUX_PLAYBACK_ID, poster: { time: 4.5 } };

  const byline = player.querySelector<HTMLElement>('[data-asc-byline]');
  if (byline) byline.textContent = BYLINE;

  return player;
}
