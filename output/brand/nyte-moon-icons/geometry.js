const N = 9;
const HALF_N = N / 2;
const SPHERE_R = 4.45;
const VOX = new Uint8Array(N * N * N);
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++)
    for (let k = 0; k < N; k++) {
      const x = i + 0.5 - HALF_N,
        y = j + 0.5 - HALF_N,
        z = k + 0.5 - HALF_N;
      if (x * x + y * y + z * z <= SPHERE_R * SPHERE_R) VOX[(i * N + j) * N + k] = 1;
    }
const RADIUS = 5.2;

// March the grid one cell at a time. Returns the hit point and the face
// entered, or null when the ray leaves the grid without touching a cell.
function traverse(ro, rd) {
  let tmin = -Infinity,
    tmax = Infinity,
    enterAxis = -1;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / rd[a];
    let t0 = (-HALF_N - ro[a]) * inv,
      t1 = (HALF_N - ro[a]) * inv;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > tmin) {
      tmin = t0;
      enterAxis = a;
    }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  let t = Math.max(tmin, 0) + 1e-5;
  const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
  const idx = [0, 0, 0],
    step = [0, 0, 0],
    tMax = [0, 0, 0],
    tDelta = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    idx[a] = Math.min(N - 1, Math.max(0, Math.floor(p[a] + HALF_N)));
    step[a] = rd[a] > 0 ? 1 : -1;
    tDelta[a] = Math.abs(1 / rd[a]);
    const edge = rd[a] > 0 ? idx[a] + 1 - HALF_N : idx[a] - HALF_N;
    tMax[a] = t + (edge - p[a]) / rd[a];
  }
  let axis = enterAxis;
  for (let n = 0; n < 3 * N + 2; n++) {
    if (VOX[(idx[0] * N + idx[1]) * N + idx[2]]) {
      const nrm = [0, 0, 0];
      nrm[axis] = -step[axis];
      return { t, nrm };
    }
    axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[axis];
    idx[axis] += step[axis];
    if (idx[axis] < 0 || idx[axis] >= N) return null;
    tMax[axis] += tDelta[axis];
  }
  return null;
}

function viewToObject(yaw, pitch) {
  // view = Rx(pitch) * Ry(yaw) * object   =>   object = Ry(-yaw) * Rx(-pitch) * view
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  // Rx(-pitch)
  const a = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  // Ry(-yaw)
  const b = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const m = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      m[i * 3 + j] = b[i * 3] * a[j] + b[i * 3 + 1] * a[3 + j] + b[i * 3 + 2] * a[6 + j];
    }
  return m;
}
function mul(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
// The sun sits to the right and a little behind: a waxing crescent.
const KEY = norm([0.8, 0.3, -0.3]);
const FILL = norm([-0.4, 0.5, 0.75]);
