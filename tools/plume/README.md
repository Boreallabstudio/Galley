# Exhaust plume

The flame and smoke behind the craft on the flight path are not drawn. They are a small fluid simulation, run once
and baked into a looping sprite sheet that the skin plays with two CSS `steps()` animations. Nothing is simulated in
the browser and no SVG filter runs while the film plays.

## Rebuild

```sh
./make.sh
```

Needs Python 3 with `numpy` and `Pillow` (with AVIF support). It writes `src/video/plume.avif` and
`src/video/plume.webp`. The run is deterministic.

## How it works

| Step | File | What it does |
| --- | --- | --- |
| Simulate | `sim2d.py` | 2D stable fluids on a 480 x 288 grid. A hot jet leaves a nozzle on the right into a slow air stream. Pressure is solved with an FFT, density and temperature move with MacCormack advection, vorticity confinement keeps the curls alive, hot gas rises and cools, and a little band-limited turbulence breaks up the edge. |
| Shade | `render.py` | Turns density and temperature into a picture: smoke lit from above with self-shadowing, billow normals, warm light from the flame, and the flame itself added on top from a temperature ramp. |
| Loop | `bake.py` | Shades every frame and closes the loop with a crossfade, so 48 frames repeat without a jump. |
| Pack | `sheet.py` | Resizes, feathers the frame edges so the plume never shows a box, and writes the 8 by 6 sprite sheet. |

## How the skin uses it

`.asc-plume` in `src/video/skin.css` shows one frame at a time (55 ms each) and is pinned to the craft's tail by
`ascent-flight` in `src/video/ascent.ts`, which sets its position, heading and size. The nozzle sits at 94.29% across
and 67.68% down each frame; the CSS offsets use those numbers, so change them together if the simulation changes.

- At Launch (`data-ignite`) the plume fires for 2.2 seconds and fades.
- During a Hold (`data-hold`, the film is buffering) the same frames play in grey as venting vapour.
- With reduced motion the launch burst is skipped and a Hold shows one still frame.
