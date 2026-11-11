# Ascent

A skin for [Video.js 10](https://videojs.org) that puts the viewer at Mission Control.

The film is the main screen and you are the flight controller. The film's progress is an orange flight path climbing across the lower part of the picture, with a craft at the playhead and the chapters marked as events along the way. Under it is your console desk: Flight, Propulsion, Comms, Screen, the next event and a large mission clock. A status board at the top polls Downlink, Audio, Captions and Flight. Once the film has played for three seconds without input, the whole console lifts away and the path sinks and fades, so nothing is drawn over the picture except captions. Move the pointer, tap, press a key or pause and everything comes back.

## Controls

- **Flight path**: click or drag anywhere along it to seek. It is a Video.js `<media-time-slider>`, so it also works from the keyboard and with screen readers.
- **Events**: one per cue in the media's `kind="chapters"` track. Choose one to jump there. When two events fall close together, the later label stands taller on a longer stem so the names never print over each other. Without a chapters track, the path is drawn on its own.
- **Flight**: the play key. On wide players it is one pill that reads Launch, Hold, Resume or Relaunch, following the film. The craft's engine flares at ignition and glows brighter at higher speeds.
- **Propulsion**: mute, volume and speed. Volume and speed are engine dials: the engine seen from behind, with a glow in its throat that grows from an ember to white-hot and a ring that shows the level. They turn like a knob: press anywhere on a dial and the bright grip on its ring goes to the pointer and follows it round. The minus and plus under each dial step it, the wheel steps it, and on touch a tap on the left or right half steps it. How they appear depends on the player's width:
  - 900 px and wider: two dials on the desk, each with its reading beside it.
  - 520 to 899 px: the same dial pops up on a small solid plate above the mute key and above a speed key, on hover, on keyboard focus, or on the first tap (the second tap acts).
  - Under 520 px: mute toggles, and the speed key cycles through the rates. Under 380 px the speed key is left out (the `<` and `>` keys still work).
- **Comms** and **Screen**: captions and fullscreen. Fullscreen uses the same desk as the normal player.
- **Next event** (1040 px and wider): a countdown to the next chapter. Choose it, or press N, to skip there.
- **Mission clock**: shows time elapsed. Choose it to switch to time remaining.
- **Status board** (900 px and wider): four lamps. Downlink reads the link rate while the film is still coming in (for example 42 Mb/s, from the playback engine's bandwidth estimate), Locked once everything to the end of the film is loaded, Hold with the rate while the film buffers, or Lost on an error. Where the engine gives no rate (the browser's own HLS) it reads Go. Audio and Captions read Go or Off. Flight reads Ready, Go, Hold or Complete. Green is used for the Go lamps only.
- **Launch and holds**: while the film plays a booster flame burns behind the craft, longer at higher speeds. A launch from the start of the film also raises a cloud of smoke from the pad; anywhere else the takeoff has already happened, so there is only the booster. Flame and cloud are fluid simulations baked into looping sprites, blended frame to frame so they move smoothly (see `tools/plume`). While the film buffers the engine idles (on the pad it vents white vapour), the main screen dims, and the console stays up. Narrower players show a "Hold · buffering" line, with the link rate, in place of the board. A launch keeps the console up until the smoke has cleared and the booster has burned on its own for two seconds.
- **Pause**: a pause is a hold called from the console. The flame pulls back into the nozzle, the main screen dims a little, and what was running waits in one slow rhythm: a beacon from the craft, the stopped clock, and a ring around the Resume key.
- **Credits and the end of the film**: as soon as the last event (the credits) begins, a light runs up the flown path and each event answers as it passes, while the craft flies the rest of the path. Then the engine cuts off and the craft goes into a parking orbit past the end of the path. The whole orbit shows at once as a faint closed course round a small body, and the craft, at full size, lights it on its first lap. It circles for as long as the credits roll (a pause holds it in place) and after the film ends, until you relaunch or move the playhead back. The console stays up through the credits so the orbit can be seen, and the readout top right reads "Credits · Parking orbit", then "Flight complete · Parking orbit". An event label in the orbit's way steps aside and returns on hover or focus.
- **Captions** are drawn by the skin and rise with the console to sit above the event labels, so they never run through the path.
- Every key has a hit area of at least 44 × 44 px, and the hit areas never overlap. With reduced motion set, the console appears and hides without the lift animation, and the glow, ignition, venting, beacon and arrival do not animate: a paused film shows a still console, and a finished one shows the orbit already drawn.

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
<video-player content-title="Charge">
  <!-- src/video/skin.html, with the placeholder replaced by: -->
  <mux-video playsinline preload="metadata" crossorigin="anonymous">
    <track kind="chapters" srclang="en" label="Events" src="chapters.vtt" default>
    <track kind="captions" srclang="en" label="English" src="captions.vtt" default>
  </mux-video>
</video-player>
```

```ts
import '@videojs/html/media/mux-video';

// The playback ID builds the stream URL; <mux-video> also supplies a poster frame (here at 4.5 s) to the skin.
document.querySelector('mux-video')!.source = { playbackId: 'YOUR_PLAYBACK_ID', poster: { time: 4.5 } };
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

Film: Charge by Blender Studio, CC BY 4.0, shortened to 38 seconds for this demo. (CC) Blender Foundation, studio.blender.org.

Made by Boreal Lab Studio, Ontario, Canada. Licensed under the [Apache License 2.0](LICENSE).
