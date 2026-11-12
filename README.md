# Ascent

A skin for [Video.js 10](https://videojs.org) that puts the viewer at Mission Control.

The film is the main screen and you are the flight controller. The film's progress is an orange flight path climbing across the lower part of the picture, with the craft at the playhead drawn the way a long-range tracking camera sees a launch at night, a white-hot point with thin diffraction spikes in two corner brackets with an ASC-1 callsign tag, and the chapters marked as events along the way. Under it is your console desk: Flight, Propulsion, Comms, Screen, the next event and a large mission clock. A status board at the top polls Downlink, Audio, Captions and Flight. Once the film has played for three seconds without input, the whole console lifts away and the path sinks and fades, so nothing is drawn over the picture except captions. Move the pointer, tap, press a key or pause and everything comes back.

## Controls

- **Flight path**: click or drag anywhere along it to seek. It is a Video.js `<media-time-slider>`, so it also works from the keyboard and with screen readers.
- **Tracking camera**: point at the path, or drag along it, and a small camera feed rides above that spot: the frame there, the mission time and the event, with a stem down to an orange crosshair on the path. Frames come from a `kind="metadata" label="thumbnails"` track (a storyboard VTT, such as Mux's); without one the card still shows the time and the event. Event labels it would cover step back while it is up.
- **Events**: one per cue in the media's `kind="chapters"` track, as nodes on the path. Only the event being flown shows its name; the others are a node and a tick until you point at them or focus them. Choose one to jump there. The course still to fly is the same orange, dashed and fainter, so the whole trajectory reads as one line. Without a chapters track, the path is drawn on its own.
- **Flight**: the play key. On wide players it is one cream key that reads Launch, Hold, Resume or Relaunch, following the film. It has the same height and corners as every other key on the desk. The craft's engine flares at ignition and glows brighter at higher speeds.
- **Propulsion**: mute, volume and speed. Volume and speed are engine dials: the engine seen from behind, with a glow in its throat that grows from an ember to white-hot and a ring that shows the level. They turn like a knob: press anywhere on a dial and the bright grip on its ring goes to the pointer and follows it round. The minus and plus under each dial step it, the wheel steps it, and on touch a tap on the left or right half steps it. How they appear depends on the player's width:
  - 900 px and wider: two dials on the desk, each with its reading beside it.
  - 520 to 899 px: the same dial pops up on a small solid plate above the mute key and above a speed key, on hover, on keyboard focus, or on the first tap (the second tap acts).
  - Under 520 px: mute toggles, and the speed key cycles through the rates. Under 380 px the speed key is left out (the `<` and `>` keys still work).
- **Comms** and **Screen**: captions, picture in picture and fullscreen. Fullscreen uses the same desk as the normal player. The picture-in-picture key shows only where the browser supports it, on players 520 px and wider.
- **Next event** (1120 px and wider): a countdown to the next chapter. Choose it, or press N, to skip there.
- **Mission clock**: shows time elapsed. Choose it to switch to time remaining.
- **Status board** (900 px and wider): four lamps. Downlink reads the link rate while the film is still coming in (for example 42 Mb/s, from the playback engine's bandwidth estimate), Locked once everything to the end of the film is loaded, Hold with the rate while the film buffers, or Lost on an error. Where the engine gives no rate (the browser's own HLS) it reads Go. Audio and Captions read Go or Off. Flight reads Ready, Go, Hold or Complete. Before launch the lamps stand by; at the first launch they are polled left to right, Flight last, as playback starts. After that the board shows only a lamp that is not Go, and Flight Complete at the end, so it stays away while all is well. Green is used for the Go lamps only.
- **Launch and holds**: while the film plays the engine's light trail burns on the flown path behind the craft, white-hot at the craft and cooling to the path's orange, longer at higher speeds. It surges at ignition and draws back into the craft on a pause. Ignition is a light event, the way a tracking camera sees an engine light: the point overexposes, its spikes stretch, and both settle. A launch from the start of the film flares at full size and washes the top of the console with a low orange glow; anywhere else the takeoff has already happened, so the flare is smaller. While the film buffers the engine idles (on the pad the point dims to a slow ember), the main screen dims, and the console stays up. Narrower players show a "Hold · buffering" line, with the link rate, in place of the board. A launch keeps the console up until the flare has settled and the trail has burned on its own for two seconds.
- **Pause**: a pause is a hold called from the console. The light trail draws back into the craft, the main screen dims a little, and what was running waits in one slow rhythm: a beacon from the craft, the stopped clock, and a ring around the Resume key.
- **Credits and the end of the film**: as soon as the last event (the credits) begins, a light runs up the flown path and each event answers as it passes, while the craft flies the rest of the path. Then the engine cuts off and the craft goes into a parking orbit past the end of the path. The whole orbit shows at once as a faint closed course round a small body, and the craft, at full size, lights it on its first lap. It circles for as long as the credits roll (a pause holds it in place) and after the film ends, until you relaunch or move the playhead back. The console stays up through the credits so the orbit can be seen, and the readout top right reads "Credits · Parking orbit", then "Flight complete · Parking orbit". The flown events fold down to their nodes, with stems shortened to ticks, so the film's title card stays whole; hover or focus brings a label back. The last event keeps its label above the orbit when there is room under the header readouts.
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
| P | Picture in picture |
| ? | Flight manual: this list, on a card in the player |

On a focused slider, the arrow keys move that slider. Escape closes an open pop-up dial and puts focus back on its key. The flight manual also opens from the "?" key on the desk (900 px and wider); it is a modal dialog, so focus moves to its Close button, stays inside it, and goes back where it was when it closes.

## Accessibility

- axe-core 4.10 (WCAG 2.0, 2.1 and 2.2 A and AA, plus best practice) reports no violations on the player, with the console up and with the flight manual open, at seven widths from 390 to 2560 px. Colour contrast over moving video cannot be computed automatically; every label sits on a solid dark plate.
- In forced colours (Windows high contrast) keys, plates, cards and dialogs get system-colour edges, active lamps light in the system highlight, and the flight path keeps its orange.
- Tested with: Chromium through Playwright at 390 to 2560 px, keyboard only, emulated touch (taps, double taps and drags on the path), forced colours and reduced motion; WebKit on macOS through Playwright, desktop and iPhone sizes; and Safari on iOS 18.6 in the iPhone 16 Pro simulator (launch, double-tap skip, pause, seeking on the path, native fullscreen, the end orbit, portrait and landscape). Not yet checked with a screen reader.
- Every control is a labelled button or slider from Video.js or a native button; the flight path is a Video.js time slider, and status changes are announced by `<media-status-announcer>`.

## Use it

Put your media in place of the placeholder in `src/video/skin.html`, inside a Video.js player, and import `src/video/skin.ts`. That import brings the stylesheet and the self-hosted fonts: Archivo (with its width axis), DM Mono and Sora. It has been tried with a plain `<video>` and with `<mux-video>` for a Mux stream, which the workbench uses.

```html
<video-player content-title="Charge">
  <!-- src/video/skin.html, with the placeholder replaced by: -->
  <mux-video playsinline preload="metadata" crossorigin="anonymous">
    <track kind="chapters" srclang="en" label="Events" src="chapters.vtt" default>
    <track kind="captions" srclang="en" label="English" src="captions.vtt" default>
    <track kind="metadata" label="thumbnails" src="https://image.mux.com/YOUR_PLAYBACK_ID/storyboard.vtt" default>
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
npm run dev        # the showcase page at /, the skin workbench at /workbench.html
npm run typecheck
npm run build      # static build in dist/
```

The skin lives in `src/video/`. `skin.html` and `skin.css` hold the player, `ascent.ts` holds the custom elements (path, events, engine dials, status board, next event, clock, captions, idle behaviour and holds), and `flight.ts` holds the shared geometry and the glow colours. The showcase page and the workbench in `apps/preview/` stream the film from Mux by its public playback ID (`apps/preview/src/frame/player.ts`), with the chapters and captions tracks served from `apps/preview/public/media/`.

## Credits

Film: Charge by Blender Studio, CC BY 4.0, shortened to 34 seconds for this demo. (CC) Blender Foundation, studio.blender.org.

Made by Boreal Lab Studio, Ontario, Canada. Licensed under the [Apache License 2.0](LICENSE).
