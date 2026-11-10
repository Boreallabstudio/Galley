# Ascent

A skin for [Video.js 10](https://videojs.org) that puts the viewer at Mission Control.

The film is the main screen and you are the flight controller. The film's progress is an orange flight path climbing across the lower part of the picture, with a craft at the playhead and the chapters marked as events along the way. Under it is your console desk: Flight, Propulsion, Comms, Screen, the next event and a large mission clock. A status board at the top polls Signal, Audio, Captions and Flight. Once the film has played for three seconds without input, the whole console lifts away and the path sinks and fades, so nothing is drawn over the picture except captions. Move the pointer, tap, press a key or pause and everything comes back.

## Controls

- **Flight path**: click or drag anywhere along it to seek. It is a Video.js `<media-time-slider>`, so it also works from the keyboard and with screen readers.
- **Events**: one per cue in the media's `kind="chapters"` track. Choose one to jump there. Without a chapters track, the path is drawn on its own.
- **Flight**: the play key. On wide players it is one pill that reads Launch, Hold, Resume or Relaunch, following the film. The craft's engine flares at ignition and glows brighter at higher speeds.
- **Propulsion**: mute, volume and speed. Volume and speed are engine dials: the engine seen from behind, with a glow in its throat that grows from an ember to white-hot and a ring that shows the level. They turn like a knob: press anywhere on a dial and the bright grip on its ring goes to the pointer and follows it round. The minus and plus under each dial step it, the wheel steps it, and on touch a tap on the left or right half steps it. How they appear depends on the player's width:
  - 900 px and wider: two dials on the desk, each with its reading beside it.
  - 520 to 899 px: the same dial pops up on a small solid plate above the mute key and above a speed key, on hover, on keyboard focus, or on the first tap (the second tap acts).
  - Under 520 px: mute toggles, and the speed key cycles through the rates. Under 380 px the speed key is left out (the `<` and `>` keys still work).
- **Comms** and **Screen**: captions and fullscreen. Fullscreen uses the same desk as the normal player.
- **Next event** (1040 px and wider): a countdown to the next chapter. Choose it, or press N, to skip there.
- **Mission clock**: shows time elapsed. Choose it to switch to time remaining.
- **Status board** (900 px and wider): four lamps. Signal reads Go, Hold while the film buffers, or Lost on an error. Audio and Captions read Go or Off. Flight reads Ready, Go, Hold or Complete. Green is used for the Go lamps only.
- **Holds**: while the film buffers, the craft vents gas as on the pad before launch, the main screen dims, and the console stays up. Narrower players show a "Hold · buffering" line in place of the board.
- **Captions** are drawn by the skin and rise with the console to sit above the event labels, so they never run through the path.
- Every key has a hit area of at least 44 × 44 px, and the hit areas never overlap. With reduced motion set, the console appears and hides without the lift animation, and the glow, ignition and venting do not animate.

## Keys

| Key | Action |
| --- | --- |
| Space or K | Play or pause |
| ← → | Seek 5 seconds |
| Page Up / Page Down | Seek a tenth of the film |
| Home / End | Start / end |
| ↑ ↓ | Volume |
| `<` `>` (or `,` `.`) | Slower / faster |
| 1–9 | Jump to that event |
| N | Skip to the next event |
| M | Mute |
| C | Captions |
| F | Fullscreen |

On a focused slider, the arrow keys move that slider. Escape closes an open pop-up dial and puts focus back on its key.

## Use it

Put your media in place of the placeholder in `src/video/skin.html`, inside a Video.js player, and import `src/video/skin.ts`. That import brings the stylesheet and the self-hosted fonts: Archivo (with its width axis), DM Mono and Sora. It has been tried with a plain `<video>` and with `<mux-video>` for a Mux stream, which the workbench uses.

```html
<video-player content-title="Spring">
  <!-- src/video/skin.html, with the placeholder replaced by: -->
  <mux-video playsinline preload="metadata" crossorigin="anonymous">
    <track kind="chapters" srclang="en" label="Events" src="chapters.vtt" default>
    <track kind="captions" srclang="en" label="English" src="captions.vtt" default>
  </mux-video>
</video-player>
```

```ts
import '@videojs/html/media/mux-video';

// The playback ID builds the stream URL; <mux-video> also supplies a poster frame (here at 30 s) to the skin.
document.querySelector('mux-video')!.source = { playbackId: 'YOUR_PLAYBACK_ID', poster: { time: 30 } };
```

The line under the title (`[data-asc-byline]`) is empty in the template; fill it from your page if you want one.

## Develop

```sh
npm install
npm run dev        # the Video.js skin workbench
npm run typecheck
npm run build      # static build in dist/
```

The skin lives in `src/video/`. `skin.html` and `skin.css` hold the player, `ascent.ts` holds the custom elements (path, events, engine dials, status board, next event, clock, captions, idle behaviour and holds), and `flight.ts` holds the shared geometry and the glow colours. The workbench in `apps/preview/` streams the film from Mux by its public playback ID (`apps/preview/src/frame/player.ts`), with the chapters and captions tracks served from `apps/preview/public/media/`.

## Credits

Film: Spring by Blender Studio, CC BY 4.0, cropped to 16:9 for this demo.

Made by Boreal Lab Studio, Ontario, Canada. Licensed under the [Apache License 2.0](LICENSE).
