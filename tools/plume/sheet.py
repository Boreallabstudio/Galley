"""Stage 2: resize the frames, feather the frame edges and write a sprite sheet."""
import numpy as np, sys, json, os
from PIL import Image
src, out, FW, FH, STEP, COLS, Q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7])
fmt = out.rsplit('.', 1)[1].upper()
L = np.load(src).astype(np.float32)[::STEP]; N = len(L)
yy, xx = np.mgrid[0:FH, 0:FW].astype(np.float32)
edge = np.clip(np.minimum.reduce([xx / (FW * 0.30), (FH - 1 - yy) / (FH * 0.14), yy / (FH * 0.14)]), 0, 1); edge = edge * edge * (3 - 2 * edge)
NOZ = json.load(open(src + '.json'))['nozzle'][0]
right = np.clip((NOZ + 0.035 - xx / FW) / 0.03, 0, 1); edge = edge * right * right * (3 - 2 * right)   # nothing spills past the nozzle onto the craft
rows = (N + COLS - 1) // COLS
sheet = np.zeros((rows * FH, COLS * FW, 4), np.float32)
for i, a in enumerate(L):
    im = np.dstack([np.asarray(Image.fromarray(np.ascontiguousarray(a[..., c]), 'F').resize((FW, FH), Image.LANCZOS), np.float32) for c in range(4)])
    im = np.clip(im, 0, 1) * edge[..., None]
    al = im[..., 3:]; rgb = im[..., :3] / np.maximum(al, 1e-3)
    r, c = divmod(i, COLS); sheet[r * FH:(r + 1) * FH, c * FW:(c + 1) * FW] = np.dstack([np.clip(rgb, 0, 1) * (al > 0.004), al])
img = Image.fromarray((np.nan_to_num(sheet) * 255 + 0.5).astype(np.uint8), 'RGBA')
if fmt == 'WEBP': img.save(out, 'WEBP', quality=Q, method=6, alpha_quality=int(os.environ.get('AQ', 100)))
elif fmt == 'AVIF': img.save(out, 'AVIF', quality=Q, speed=4)
else: img.save(out)
meta = json.load(open(src + '.json')); meta.update(frames=N, cols=COLS, rows=rows, fw=FW, fh=FH)
json.dump(meta, open(out + '.json', 'w'))
print(out, img.size, 'frames', N, os.path.getsize(out) // 1024, 'KB')
