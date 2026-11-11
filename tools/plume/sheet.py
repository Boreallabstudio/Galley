"""Stage 2: resize the frames, feather the frame edges and write a sprite sheet."""
import numpy as np, sys, json, os
from PIL import Image
src, out, FW, FH, STEP, COLS, Q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7])
fmt = out.rsplit('.', 1)[1].upper()
L = np.load(src).astype(np.float32)[::STEP]; N = len(L)
yy, xx = np.mgrid[0:FH, 0:FW].astype(np.float32)
# Feather widths as fractions of the frame: left, top, right, bottom. 0 keeps a hard edge (a wall or a floor).
FL, FT, FR, FB = [float(os.environ.get(k, v)) for k, v in (('FL', 0.30), ('FT', 0.14), ('FR', -1), ('FB', 0.14))]
ramps = [np.ones_like(xx)]
if FL: ramps.append(xx / (FW * FL))
if FT: ramps.append(yy / (FH * FT))
if FB: ramps.append((FH - 1 - yy) / (FH * FB))
if FR > 0: ramps.append((FW - 1 - xx) / (FW * FR))
edge = np.clip(np.minimum.reduce(ramps), 0, 1); edge = edge * edge * (3 - 2 * edge)
if os.environ.get('ROUND'):                                                # a cloud in a corner: fade with distance from the bottom left
    far = np.sqrt((xx / FW) ** 2 + ((FH - 1 - yy) / FH) ** 2)
    rnd = np.clip((1.0 - far) / float(os.environ['ROUND']), 0, 1); edge = edge * rnd * rnd * (3 - 2 * rnd)
if FR < 0:                                                                 # nothing spills past the nozzle onto the craft
    NOZ = json.load(open(src + '.json'))['nozzle'][0]
    right = np.clip((NOZ + 0.035 - xx / FW) / 0.03, 0, 1); edge = edge * right * right * (3 - 2 * right)
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
