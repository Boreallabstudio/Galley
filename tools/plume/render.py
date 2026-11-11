"""Light the simulated fields like a real plume and write RGBA frames (straight alpha)."""
import numpy as np, sys
from PIL import Image
def blur(f, s):
    H, W = f.shape; ky = np.fft.fftfreq(H)[:, None]; kx = np.fft.rfftfreq(W)[None, :]
    return np.fft.irfft2(np.fft.rfft2(f) * np.exp(-2 * (np.pi * s) ** 2 * (kx ** 2 + ky ** 2)), s=f.shape).astype(np.float32)
def up(f, k):
    if k == 1: return f
    return np.asarray(Image.fromarray(f.astype(np.float32), 'F').resize((f.shape[1] * k, f.shape[0] * k), Image.BICUBIC), np.float32)
def ramp(t, stops):
    xs = [s[0] for s in stops]; out = np.zeros(t.shape + (3,), np.float32)
    for c in range(3): out[..., c] = np.interp(t, xs, [s[1][c] for s in stops])
    return out
FIRE = [(0.0, (0.16, 0.02, 0.0)), (0.22, (0.70, 0.20, 0.02)), (0.42, (1.0, 0.36, 0.06)), (0.62, (1.0, 0.68, 0.22)), (0.8, (1.0, 0.9, 0.62)), (1.0, (1.0, 0.98, 0.93))]
def shade(d, T, noz, K=2, P={}):
    g = lambda k, v: P.get(k, v)
    d = np.maximum(up(d, K), 0); T = np.clip(up(T, K), 0, 1)
    if g('tb', 0): T = np.clip(blur(T, g('tb', 0) * K), 0, 1)                 # a softer edge to the flame
    if g('db', 0): d = np.maximum(blur(d, g('db', 0) * K), 0)                 # smoke has soft edges
    hz = g('haze', 0.05); d = d * d / (d + hz)                              # old smoke clears instead of leaving a veil, without a hard edge
    H, W = d.shape; yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx, ny = noz[0] * K, noz[1] * K
    a_s = 1 - np.exp(-g('ka', 1.5) * d)                                   # smoke opacity
    a_s = a_s * g('smoke', 1.0)                                           # 0: the flame alone, for the booster
    # self-shadow: light comes from above and a little from the left
    sh = np.exp(-g('ks', 0.045) / K * np.cumsum(blur(d, 1.5 * K), axis=0))
    # billow shading from the thickness field
    h = blur(a_s, g('nb', 3.4) * K); gx = np.gradient(h, axis=1) * g('ns', 15) * K; gy = np.gradient(h, axis=0) * g('ns', 15) * K
    nz = 1 / np.sqrt(gx * gx + gy * gy + 1); L = np.array([-0.35, -0.78, 0.52]); L /= np.linalg.norm(L)
    diff = np.clip((-gx * nz) * L[0] + (-gy * nz) * L[1] + nz * L[2], 0, 1)
    lit = g('amb', 0.30) + (1 - g('amb', 0.30)) * sh * (0.45 + 0.55 * diff)
    lit = 1 - (1 - lit) * np.clip(a_s * 1.6, 0, 1)
    top = np.array(g('top', (0.93, 0.92, 0.90)), np.float32); low = np.array(g('low', (0.40, 0.41, 0.45)), np.float32)
    col = low + (top - low) * lit[..., None]
    # the flame lights the smoke near it
    r = np.sqrt((xx - nx) ** 2 + (yy - ny) ** 2) / (g('glow_r', 46) * K)
    warm = g('glow', 0.9) / (1 + r * r) ** 1.3
    tint = np.array([1.0, 0.74, 0.34], np.float32)
    w = np.clip(warm, 0, 1)[..., None]
    col = col * (1 - w + w * tint * 1.18)
    hot = np.clip((T - 0.08) * 1.6, 0, 1)[..., None] * g('hot', 1.0)                              # smoke that is still hot is lit from inside
    col = col * (1 - hot) + np.maximum(col, np.array([1.0, 0.70, 0.26], np.float32)) * hot
    # the flame itself: hot gas glows, white at the core
    e = np.clip((T - g('t0', 0.16)) / (1 - g('t0', 0.16)), 0, 1)
    a_e = np.clip(e ** g('eg', 0.8) * np.minimum(d * g('ed', 1.6), 1) * g('ea', 1.25), 0, 1)
    fire = ramp(e ** g('fg', 0.75), g('ramp', FIRE)) * g('fb', 1.15)
    a = 1 - (1 - a_s) * (1 - a_e)
    # light adds: glowing gas brightens the smoke around it instead of painting over it
    pre = col * a_s[..., None] * (1 - 0.35 * a_e[..., None]) + fire * a_e[..., None]
    if g('bloom', 0):                                                     # a soft halo of light around the flame
        halo = blur((fire * a_e[..., None]).max(axis=2), g('bloom_r', 5) * K)[..., None] * np.array(g('bloom_c', (1.0, 0.5, 0.14)), np.float32) * g('bloom', 0)
        pre = pre + halo * (1 - a[..., None]); a = np.maximum(a, np.clip(halo.max(axis=2), 0, 1))
    return np.dstack([np.clip(pre / np.maximum(a[..., None], 1e-4), 0, 1), a])
if __name__ == '__main__':
    z = np.load(sys.argv[1]); d = z['d'].astype(np.float32); T = z['T'].astype(np.float32); noz = z['nozzle']
    i = int(sys.argv[2]); K = 2
    f = shade(d[i], T[i], noz, K)
    m = 30 * K; f = f[m:-m, m:-m]
    H, W = f.shape[:2]
    tiles = []
    for bg in [(5, 7, 11), (40, 62, 110), (150, 170, 190), (236, 232, 222)]:
        b = np.zeros((H, W, 3), np.float32) + np.array(bg, np.float32) / 255
        tiles.append(b * (1 - f[..., 3:]) + f[..., :3] * f[..., 3:])
    out = np.vstack([np.hstack(tiles[:2]), np.hstack(tiles[2:])])
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3] if len(sys.argv) > 3 else 'r.png')
    print(out.shape)
