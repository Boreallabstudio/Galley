import '@videojs/html/i18n';
import '@videojs/html/video/player';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';
import './site.css';

const PLACEHOLDER = '<!-- Add a compatible media component here. -->';

/** Set VITE_MUX_PLAYBACK_ID at build time to stream from Mux; without it the page plays the local file. */
const MUX_ID: string | undefined = import.meta.env.VITE_MUX_PLAYBACK_ID;
if (MUX_ID) await import('@videojs/html/media/mux-video');

const tracks = `
  <track kind="captions" label="English" srclang="en" src="./media/rice-1962-en.vtt">
  <track kind="chapters" label="English" srclang="en" src="./media/rice-1962-chapters.vtt" default>
  <track kind="metadata" label="galley" srclang="en" src="./media/rice-1962-notes.vtt">`;

const media = MUX_ID
  ? `<mux-video src="https://stream.mux.com/${MUX_ID}.m3u8" poster="./media/rice-1962-poster.jpg" playsinline preload="metadata" crossorigin="anonymous">${tracks}
</mux-video>`
  : `<video src="./media/rice-1962.mp4" poster="./media/rice-1962-poster.jpg" playsinline preload="metadata" crossorigin="anonymous">${tracks}
</video>`;

const i18n = document.createElement('media-i18n');
const player = document.createElement('video-player');
player.setAttribute('poster', './media/rice-1962-poster.jpg');
player.setAttribute('content-title', 'We choose to go to the Moon');
player.innerHTML = skinTemplate.replace(PLACEHOLDER, media);
i18n.append(player);
document.getElementById('stage-player')!.append(i18n);

const skin = player.querySelector<HTMLElement>('.gl');
skin?.style.setProperty('--gl-plate-ratio', '4 / 3');
