# Ascent

A skin for [Video.js 10](https://videojs.org) that draws the timeline as a flight path.

The film's progress is an orange line climbing across the lower part of the picture, with a craft at the playhead and the chapters marked as events along the way. Data sits at the edges of the frame: the title top left, the event in progress top right, and a large mission clock bottom right. Once the film has played for three seconds without input, the controls lift away and the path sinks and fades, so nothing is drawn over the picture except captions. Move the pointer, tap, press a key or pause and everything comes back.

## Controls

- **Flight path**: click or drag anywhere along it to seek. It is a Video.js `<media-time-slider>`, so it also works from the keyboard and with screen readers.
- **Events**: one per cue in the media's `kind="chapters"` track. Choose one to jump there. Without a chapters track, the path is drawn on its own.
- **Bottom row**: play, mute, captions and fullscreen. How volume and speed appear depends on the player's width:
  - 900 px and wider: two small inline sliders, one for volume and one for speed, in the row.
  - 520 to 899 px: a small ladder pops up over the mute button and over a speed button, on hover, on keyboard focus, or on the first tap (the second tap acts).
  - Under 520 px: mute toggles, and the speed button cycles through the rates.
  - Fullscreen: large volume and speed ladders at the sides of the frame.
- **Mission clock**: shows time elapsed. Choose it to switch to time remaining.
- **Captions** are drawn by the skin and rise with the controls, so they never sit on the path.

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
| M | Mute |
| C | Captions |
| F | Fullscreen |

On a focused slider, the arrow keys move that slider.

## Use it

Put your media in place of the placeholder in `src/video/skin.html`, inside a Video.js player, and import `src/video/skin.ts`. That import brings the stylesheet and the self-hosted fonts: Archivo (with its width axis), DM Mono and Sora.

```html
<video-player content-title="Spring">
  <!-- src/video/skin.html, with the placeholder replaced by: -->
  <video src="film.mp4" playsinline preload="metadata">
    <track kind="chapters" srclang="en" label="Events" src="chapters.vtt" default>
    <track kind="captions" srclang="en" label="English" src="captions.vtt" default>
  </video>
</video-player>
```

The line under the title (`[data-asc-byline]`) is empty in the template; fill it from your page if you want one.

## Develop

```sh
npm install
npm run dev        # the Video.js skin workbench
npm run typecheck
npm run build      # static build in dist/
```

The skin lives in `src/video/`. `skin.html` and `skin.css` hold the player, `ascent.ts` holds the custom elements (path, events, ladders, clock, captions, idle behaviour), and `flight.ts` holds the shared geometry. The workbench in `apps/preview/` plays `apps/preview/public/spring-720-16x9.mp4`. The film is not kept in the repository, so add it there yourself.

## Credits

Film: Spring by Blender Studio, CC BY 4.0, cropped to 16:9 for this demo.

Made by Boreal Lab Studio, Ontario, Canada. Licensed under the [Apache License 2.0](LICENSE).
