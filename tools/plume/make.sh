#!/bin/bash
# Rebuilds the exhaust plume sprite sheets used by the Ascent skin (src/video/plume.avif and plume.webp).
# Needs Python 3 with numpy and Pillow (with AVIF support). Takes a few minutes; the result is deterministic.
set -e
cd "$(dirname "$0")"
OUT=../../src/video
WORK=${WORK:-$(mktemp -d)}

# 1. Simulate: 480 x 288 cells, 230 warm-up frames, then 62 kept frames. Jet speed 4.2, air stream 0.7.
TURB=0.38 TP=1.2 R=0.042 SRC=0.85 DIFF=0.10 EPS=0.2 FADE=0.9872 BUOY=0.06 \
  python3 sim2d.py 480 288 230 62 "$WORK/fields.npz" 4.2 0.7

# 2. Shade every frame and close the loop: 48 frames with a 12 frame crossfade.
P='{"ka":2.2,"amb":0.5,"db":1.6,"haze":0.05,"top":[0.97,0.96,0.94]}' \
  python3 bake.py "$WORK/fields.npz" "$WORK/loop.npy" 48 12

# 3. Sprite sheets, 8 columns by 6 rows. AVIF is what browsers load; WebP is the fallback.
python3 sheet.py "$WORK/loop.npy" "$WORK/plume.avif" 400 216 1 8 55
AQ=100 python3 sheet.py "$WORK/loop.npy" "$WORK/plume.webp" 288 156 1 8 62

cp "$WORK/plume.avif" "$WORK/plume.webp" "$OUT/"
cat "$WORK/plume.avif.json"; echo
echo "Wrote $OUT/plume.avif and $OUT/plume.webp"
