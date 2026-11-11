#!/bin/bash
# Rebuilds the exhaust sprite sheets used by the Ascent skin: the booster flame and the liftoff cloud
# (src/video/booster.* and src/video/liftoff.*).
# Needs Python 3 with numpy and Pillow (with AVIF support). Takes a few minutes; the result is deterministic.
set -e
cd "$(dirname "$0")"
export PYTHONDONTWRITEBYTECODE=1
OUT=../../src/video
WORK=${WORK:-$(mktemp -d)}

# ---- Booster: a straight jet into the air stream past the craft. Only the flame is kept. ----
# 360 x 152 cells, 80 warm-up frames, then 62 kept frames. Jet speed 4.2, air stream 1.6.
TURB=0.15 TP=1.2 R=0.08 SRC=0.85 BUOY=0 NYF=0.5 EPS=0.2 DIFF=0.10 FADE=0.9872 \
  python3 sim2d.py 360 152 80 62 "$WORK/booster.npz" 4.2 1.6
# Shade with the smoke switched off, and close the loop: 48 frames with a 12 frame crossfade.
P='{"smoke":0,"t0":0.28,"eg":0.7,"ea":2.2,"ed":3,"tb":0.9,"bloom":0.35,"bloom_r":6,"ramp":[[0,[0.9,0.25,0.02]],[0.3,[1,0.42,0.06]],[0.55,[1,0.6,0.14]],[0.8,[1,0.85,0.5]],[1,[1,0.98,0.93]]]}' \
  python3 bake.py "$WORK/booster.npz" "$WORK/booster.npy" 48 12
# Sprite sheets, 8 columns by 6 rows. AVIF is what browsers load; WebP is the fallback.
FL=0.15 FT=0.1 FB=0.1 python3 sheet.py "$WORK/booster.npy" "$WORK/booster.avif" 384 118 1 8 60
FL=0.15 FT=0.1 FB=0.1 AQ=100 python3 sheet.py "$WORK/booster.npy" "$WORK/booster.webp" 256 78 1 8 70

# ---- Liftoff cloud: the jet fires into a corner, a wall on the left and a floor below. Only the smoke is kept. ----
# 480 x 360 cells, 150 warm-up frames, then 62 kept frames. No air stream; a light breeze along the flight path.
PAD=1 ANG=45 TP=1.2 R=14 SRC=1.4 TURB=0.6 DRIFT=0.04 BUOY=0.03 COOL=0.955 EPS=0.2 DIFF=0.10 FADE=0.987 \
  python3 sim2d.py 480 360 150 62 "$WORK/liftoff.npz" 4.2 0
# Shade with the flame switched off (the booster draws it) and a little warmth left in the corner.
P='{"ka":2.2,"amb":0.5,"db":1.6,"haze":0.05,"top":[0.97,0.96,0.94],"ea":0,"glow":0.45,"glow_r":34,"hot":0.55}' \
  python3 bake.py "$WORK/liftoff.npz" "$WORK/liftoff.npy" 48 12
# The left and bottom edges stay hard (wall and floor); the cloud fades with distance from the corner.
FL=0 FT=0 FB=0.03 FR=0 ROUND=0.34 python3 sheet.py "$WORK/liftoff.npy" "$WORK/liftoff.avif" 400 294 1 8 55
FL=0 FT=0 FB=0.03 FR=0 ROUND=0.34 AQ=80 python3 sheet.py "$WORK/liftoff.npy" "$WORK/liftoff.webp" 240 176 1 8 50

cp "$WORK"/booster.avif "$WORK"/booster.webp "$WORK"/liftoff.avif "$WORK"/liftoff.webp "$OUT/"
cat "$WORK/booster.avif.json"; echo; cat "$WORK/liftoff.avif.json"; echo
echo "Wrote booster and liftoff sheets to $OUT"
