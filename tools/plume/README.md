# Exhaust

The cloud at liftoff is not drawn. It is a small fluid simulation, run once and baked into a looping sprite sheet
that the skin plays in CSS. Nothing is simulated in the browser and no SVG filter runs while the film plays. (The
booster flame on the craft's tail is drawn in CSS, as a white-hot jet with shock diamonds; see `.asc-booster` in
`src/video/skin.css`. An earlier version baked it here too.)

- **Liftoff cloud** (`src/video/liftoff.avif`, `.webp`): smoke rising from the pad, the corner between the player's
  left edge and the console desk. It shows only for a launch from the start of the film, and as white vapour for a
  hold there. Anywhere else on the path the takeoff has already happened, so there is only the booster.

## Rebuild

```sh
./make.sh
```

Needs Python 3 with `numpy` and `Pillow` (with AVIF support). The run is deterministic.

## How it works

| Step | File | What it does |
| --- | --- | --- |
| Simulate | `sim2d.py` | 2D stable fluids. A hot jet leaves a nozzle into the air. Pressure is solved with an FFT, density and temperature move with MacCormack advection, vorticity confinement keeps the curls alive, hot gas rises and cools, and a little band-limited turbulence breaks up the edges. With `PAD=1` the jet fires into a corner (a wall and a floor) and the smoke splashes up and rolls along the ground. |
| Shade | `render.py` | Turns density and temperature into a picture: smoke lit from above with self-shadowing and billow normals, warm light from the flame, and the flame itself from a temperature ramp with a soft halo. Smoke or flame can be switched off. |
| Loop | `bake.py` | Shades every frame and closes the loop with a crossfade, so 48 frames repeat without a jump. |
| Pack | `sheet.py` | Resizes, feathers the edges so no frame ever shows a box, and writes the 8 by 6 sprite sheet. |

## How the skin uses it

`.asc-fx` in `src/video/skin.css` plays the sheet on two layers. One shows the even frames and the other the odd
frames, a frame apart, and they cross-fade with `mix-blend-mode: plus-lighter`, which makes the fade an exact blend.
So the motion is continuous at the screen's own rate, not 18 steps a second, and each layer only changes frame while
it is fully faded out.

`ascent-flight` in `src/video/ascent.ts` keeps the cloud on the pad. The craft stands 18.24% across and 84.46% down
each frame, and the cloud is scaled until its left edge, the wall in the simulation, is the player's left edge.

Change those numbers in the CSS together with the simulation if the pad moves.

With reduced motion there is no launch effect, and a hold on the pad shows one still frame of vapour.
