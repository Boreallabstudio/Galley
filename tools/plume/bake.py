"""Stage 1: shade every simulated frame and close the loop with a crossfade. Saves premultiplied RGBA frames."""
import numpy as np, sys, json, os
from render import shade
src, out = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 64; X = int(sys.argv[4]) if len(sys.argv) > 4 else 14
P = json.loads(os.environ.get('P', '{}'))
z = np.load(src); d = z['d'].astype(np.float32); T = z['T'].astype(np.float32); noz = z['nozzle']
ML, MT, MR, MB = [int(c) for c in z['crop']]
assert len(d) >= N + X, (len(d), N + X)
frames = []
for i in range(N + X):
    f = shade(d[i], T[i], noz, 2, P)[MT * 2:-MB * 2, ML * 2:-MR * 2]
    frames.append(np.dstack([f[..., :3] * f[..., 3:], f[..., 3]]).astype(np.float32))
loop = []
for i in range(N):
    a = frames[i + X]
    if i >= N - X:
        w = (i - (N - X) + 1) / (X + 1); w = w * w * (3 - 2 * w)
        a = a * (1 - w) + frames[i - (N - X)] * w
    loop.append(a)
H0 = d.shape[1] - MT - MB; W0 = d.shape[2] - ML - MR
np.save(out, np.array(loop, np.float16))
json.dump({'nozzle': [float((noz[0] - ML) / W0), float((noz[1] - MT) / H0)]}, open(out + '.json', 'w'))
print('frames', len(loop), loop[0].shape, 'nan', int(np.isnan(np.array(loop)).sum()))
