#!/bin/bash
# Rebuilds the liftoff cloud sprite sheets used by the Ascent skin (src/video/liftoff.*). The booster flame on
# the craft is drawn in CSS and does not come from here.
# Needs Python 3 with numpy and Pillow (with AVIF support). Takes a few minutes; the result is deterministic.
set -e
cd "$(dirname "$0")"
export PYTHONDONTWRITEBYTECODE=1
OUT=../../src/video
WORK=${WORK:-$(mktemp -d)}

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

cp "$WORK"/liftoff.avif "$WORK"/liftoff.webp "$OUT/"
cat "$WORK/liftoff.avif.json"; echo
echo "Wrote liftoff sheets to $OUT"
