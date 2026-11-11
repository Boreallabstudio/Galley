"""2D smoke plume: stable fluids (periodic FFT projection) + vorticity confinement + MacCormack density.
The jet blows towards -x from a nozzle on the right; hot gas rises and cools into smoke. With PAD=1 the jet fires
into a corner instead, for liftoff, and the smoke splashes up the wall and along the floor. Saves raw fields per frame."""
import numpy as np, sys, time, os
rng = np.random.default_rng(7)
W, H = int(sys.argv[1]) if len(sys.argv) > 1 else 448, int(sys.argv[2]) if len(sys.argv) > 2 else 256
WARM, FRAMES, SUB = int(sys.argv[3]) if len(sys.argv) > 3 else 140, int(sys.argv[4]) if len(sys.argv) > 4 else 72, 2
OUT = sys.argv[5] if len(sys.argv) > 5 else 'fields.npz'
dt = 1.0
E = lambda k, v: float(os.environ.get(k, v))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u = np.zeros((H, W), np.float32); v = np.zeros_like(u); d = np.zeros_like(u); T = np.zeros_like(u)
kx = np.fft.fftfreq(W)[None, :] * 2 * np.pi; ky = np.fft.fftfreq(H)[:, None] * 2 * np.pi
k2 = kx ** 2 + ky ** 2; k2[0, 0] = 1

def sample(f, x, y):
    x = np.mod(x, W); y = np.mod(y, H)
    x0 = np.floor(x).astype(np.int32); y0 = np.floor(y).astype(np.int32)
    fx = x - x0; fy = y - y0; x0 %= W; y0 %= H; x1 = (x0 + 1) % W; y1 = (y0 + 1) % H
    return (f[y0, x0] * (1 - fx) + f[y0, x1] * fx) * (1 - fy) + (f[y1, x0] * (1 - fx) + f[y1, x1] * fx) * fy

def advect(f, uu, vv, mac=False):
    xb = xx - dt * uu; yb = yy - dt * vv
    f1 = sample(f, xb, yb)
    if not mac: return f1
    f0 = sample(f1, xx + dt * uu, yy + dt * vv)       # back and forth
    f2 = f1 + 0.5 * (f - f0)
    # clamp to the neighbourhood so the correction cannot ring
    x0 = np.floor(np.mod(xb, W)).astype(np.int32) % W; y0 = np.floor(np.mod(yb, H)).astype(np.int32) % H; x1 = (x0 + 1) % W; y1 = (y0 + 1) % H
    n = np.stack([f[y0, x0], f[y0, x1], f[y1, x0], f[y1, x1]])
    return np.clip(f2, n.min(0), n.max(0))

def project(uu, vv):
    U = np.fft.fft2(uu); V = np.fft.fft2(vv)
    div = 1j * kx * U + 1j * ky * V
    p = div / (-k2)
    U -= 1j * kx * p; V -= 1j * ky * p
    return np.fft.ifft2(U).real.astype(np.float32), np.fft.ifft2(V).real.astype(np.float32)

def ddx(f): return (np.roll(f, -1, 1) - np.roll(f, 1, 1)) * 0.5
def ddy(f): return (np.roll(f, -1, 0) - np.roll(f, 1, 0)) * 0.5

# nozzle and sponge
PAD = int(E('PAD', 0))                                                      # liftoff: the jet fires into a corner
if PAD:
    # A wall on the left and a floor below: the left edge of the player and the top of the console desk.
    WALL, FLOOR, CELL = 30, H - 20, 420 / 340                               # CELL: grid cells per CSS pixel at full size
    NX, NY = WALL + 62 * CELL, FLOOR - 39 * CELL
    R = E('R', 12.0)
    ANG = np.radians(E('ANG', 24.4))                                        # the exhaust points down and back
    JX, JY = -np.cos(ANG), np.sin(ANG)
    along = (xx - NX) * JX + (yy - NY) * JY; across = -(xx - NX) * JY + (yy - NY) * JX
    noz = np.exp(-((along / (R * 1.6)) ** 2 + (across / R) ** 2))
    solid = ((xx < WALL) | (yy >= FLOOR)).astype(np.float32); fluid = 1 - solid
    edge = np.minimum(W - 1 - xx, yy)                                       # open air above and to the right
    CROP = (WALL, 30, 30, H - FLOOR)                                        # left, top, right, bottom
else:
    NX, NY = W - 54.0, H * E('NYF', 0.64)
    R = H * float(os.environ.get('R', 0.030))                               # nozzle radius
    JX, JY = -1.0, 0.0
    noz = np.exp(-(((xx - NX) / (R * 1.6)) ** 2 + ((yy - NY) / R) ** 2))
    fluid = None
    edge = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy])
    CROP = (30, 30, 30, 30)
sponge = np.clip(edge / 30.0, 0, 1) ** 1.5

def walls(uu, vv):
    """Keeps the flow out of the wall and the floor: stop it there, re-solve, a few times."""
    if fluid is None: return project(uu, vv)
    for _ in range(4):
        uu, vv = project(uu * fluid, vv * fluid)
    return uu * fluid, vv * fluid
U0 = float(sys.argv[6]) if len(sys.argv) > 6 else 4.2
UBG = -float(sys.argv[7]) if len(sys.argv) > 7 else -0.55   # air streaming past the craft
u += UBG
DRIFT = E('DRIFT', 0.0); BUOY = E('BUOY', 0.07); COOL = E('COOL', 0.972); FADE = E('FADE', 0.9885); EPS = E('EPS', 0.32); DIFF = E('DIFF', 0.07)

def band_noise(seed):
    r = np.random.default_rng(seed)
    kk = np.sqrt(k2); lo, hi = 2 * np.pi / E('TL1', 34), 2 * np.pi / E('TL0', 9)
    amp = ((kk > lo) & (kk < hi)) / np.maximum(kk, 1e-3)
    psi = np.fft.ifft2(amp * np.exp(2j * np.pi * r.random((H, W)))).real
    psi /= np.abs(psi).max()
    return ddy(psi).astype(np.float32), (-ddx(psi)).astype(np.float32)
TURB = E('TURB', 0.0); TPER = 26
_tn = {}
def turb(i):
    a = i // TPER; f = (i % TPER) / TPER; f = f * f * (3 - 2 * f)
    for k in (a, a + 1):
        if k not in _tn: _tn[k] = band_noise(1000 + k)
    for k in list(_tn):
        if k < a: del _tn[k]
    return _tn[a][0] * (1 - f) + _tn[a + 1][0] * f, _tn[a][1] * (1 - f) + _tn[a + 1][1] * f

def step(i):
    global u, v, d, T
    # source: a pulsing, wobbling jet
    wob = 0.55 * np.sin(i * 0.37) + 0.35 * np.sin(i * 0.91 + 1.3) + rng.normal() * 0.25
    pulse = 1 + 0.18 * np.sin(i * 0.63) + rng.normal() * 0.08
    m = noz
    u = u * (1 - m) + m * (U0 * pulse * JX - wob * 0.75 * JY)
    v = v * (1 - m) + m * (U0 * pulse * JY + wob * 0.75 * JX)
    jitter = rng.normal(size=(H // 4, W // 4)).astype(np.float32).repeat(4, 0).repeat(4, 1)
    v += m * jitter * 0.9; u += m * jitter[::-1] * 0.5
    d += m * E('SRC', 0.55); T = np.maximum(T, np.clip(m ** E('TP', 1.0) * 1.15, 0, 1))
    if TURB:
        tu, tv = turb(i); msk = np.clip(d * 1.5, 0, 1) * TURB * (1 - 0.85 * np.clip(T * 1.5, 0, 1))   # the jet core stays a jet
        u += tu * msk; v += tv * msk
    # forces
    v -= BUOY * T * dt                                # up is -y
    if DRIFT: u += DRIFT * np.clip(d, 0, 1) * dt     # a light breeze carries the smoke along the flight path
    w = ddx(v) - ddy(u); aw = np.abs(w)
    gx, gy = ddx(aw), ddy(aw); mag = np.sqrt(gx * gx + gy * gy) + 1e-5
    u += EPS * (gy / mag) * w * dt; v -= EPS * (gx / mag) * w * dt
    u, v = walls(u, v)
    un, vn = advect(u, u, v), advect(v, u, v)
    d = advect(d, u, v, mac=True); T = advect(T, u, v, mac=True)
    u, v = UBG + (un - UBG) * sponge, vn * sponge
    u, v = walls(u, v)
    d += DIFF * (np.roll(d, 1, 0) + np.roll(d, -1, 0) + np.roll(d, 1, 1) + np.roll(d, -1, 1) - 4 * d)   # smoke softens as it ages
    d *= FADE * sponge; T *= COOL * sponge
    if fluid is not None: d *= fluid; T *= fluid
    u *= 0.9985; v *= 0.9985

t0 = time.time(); i = 0
for _ in range(WARM * SUB): step(i); i += 1
D, TT = [], []
for f in range(FRAMES):
    for _ in range(SUB): step(i); i += 1
    D.append(d.copy()); TT.append(T.copy())
np.savez_compressed(OUT, d=np.array(D, np.float16), T=np.array(TT, np.float16), nozzle=np.array([NX, NY, R]), crop=np.array(CROP))
print('done', W, H, 'steps', i, f'{time.time() - t0:.1f}s', 'dmax', float(d.max()), 'Tmax', float(T.max()))
