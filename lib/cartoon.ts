import * as THREE from 'three';

/** Residue row from lib/catalase-1dgf.json: [resnum, CAx, CAy, CAz, Ox, Oy, Oz, 'H' | 'E' | 'C'] */
export type ResRow = [number, number, number, number, number, number, number, string];

const SUB = 8; // spline samples per residue
const SIDES = 12; // cross-section resolution

/**
 * Cartoon ribbon for one protein chain (alpha carbon spline):
 * helices = wide flat ribbon, strands = flat arrows, loops = thin round tubes.
 * Units are Ångström; the caller scales the result.
 */
export function cartoonGeometry(rows: ResRow[], color: THREE.Color) {
  // split at chain breaks
  const segs: ResRow[][] = [];
  let cur: ResRow[] = [];
  rows.forEach((r, i) => {
    if (i > 0) {
      const p = rows[i - 1];
      const d = Math.hypot(r[1] - p[1], r[2] - p[2], r[3] - p[3]);
      if (d > 4.3) {
        segs.push(cur);
        cur = [];
      }
    }
    cur.push(r);
  });
  segs.push(cur);

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const helixCol = color.clone();
  const sheetCol = color.clone().offsetHSL(0, 0, 0.06);
  const coilCol = color.clone().offsetHSL(0, -0.1, -0.04);

  for (const seg of segs) {
    if (seg.length < 3) continue;
    const ca = seg.map((r) => new THREE.Vector3(r[1], r[2], r[3]));
    const curve = new THREE.CatmullRomCurve3(ca, false, 'catmullrom', 0.5);
    // guide normals from the carbonyl oxygens, made consistent along the chain
    const guide: THREE.Vector3[] = [];
    seg.forEach((r, i) => {
      const n = new THREE.Vector3(r[4] - r[1], r[5] - r[2], r[6] - r[3]).normalize();
      if (i > 0 && n.dot(guide[i - 1]) < 0) n.negate();
      guide.push(n);
    });
    const ssOf = (i: number) => seg[Math.min(seg.length - 1, Math.max(0, i))][7];
    const n = (seg.length - 1) * SUB + 1;
    let prevN: THREE.Vector3 | null = null;
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const p = curve.getPoint(u);
      const t = curve.getTangent(u).normalize();
      const fi = k / SUB;
      const i0 = Math.floor(fi);
      const f = fi - i0;
      const g = guide[i0].clone().lerp(guide[Math.min(i0 + 1, guide.length - 1)], f);
      // orthogonalise against tangent
      let nn = g.sub(t.clone().multiplyScalar(g.dot(t))).normalize();
      if (prevN && nn.dot(prevN) < 0) nn.negate();
      if (!isFinite(nn.x)) nn = prevN ? prevN.clone() : new THREE.Vector3(0, 1, 0);
      prevN = nn.clone();
      const b = new THREE.Vector3().crossVectors(t, nn).normalize();

      // cross-section size, smoothly blended between residues
      const ri = Math.round(fi);
      const ss = ssOf(ri);
      const size = (s: string, i: number, local: number) => {
        if (s === 'H') return [1.75, 0.38];
        if (s === 'E') {
          const last = ssOf(i + 1) !== 'E';
          if (last) return [2.5 * (1 - local) + 0.35 * local, 0.38]; // arrow head
          return [1.5, 0.38];
        }
        return [0.36, 0.36];
      };
      const a = size(ssOf(i0), i0, f);
      const c = size(ssOf(i0 + 1), i0 + 1, 0);
      let w: number, h: number;
      if (ssOf(i0) === 'E' && ssOf(i0 + 1) !== 'E') {
        [w, h] = a; // keep the sharp arrow
      } else {
        const s = f * f * (3 - 2 * f);
        w = a[0] + (c[0] - a[0]) * s;
        h = a[1] + (c[1] - a[1]) * s;
      }
      const cc = ss === 'H' ? helixCol : ss === 'E' ? sheetCol : coilCol;
      for (let j = 0; j < SIDES; j++) {
        const ang = (j / SIDES) * Math.PI * 2;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        // superellipse for flat-ish ribbons with rounded edges
        const e = 0.55;
        const px = Math.sign(cx) * Math.pow(Math.abs(cx), e) * w;
        const py = Math.sign(sy) * Math.pow(Math.abs(sy), e) * h;
        const v = p.clone().addScaledVector(nn, px).addScaledVector(b, py);
        pos.push(v.x, v.y, v.z);
        const nrm = nn.clone().multiplyScalar(cx / Math.max(w, 0.01)).addScaledVector(b, sy / Math.max(h, 0.01)).normalize();
        nor.push(nrm.x, nrm.y, nrm.z);
        col.push(cc.r, cc.g, cc.b);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let j = 0; j < SIDES; j++) {
        const a = base + k * SIDES + j;
        const b2 = base + k * SIDES + ((j + 1) % SIDES);
        const c2 = a + SIDES;
        const d = b2 + SIDES;
        idx.push(a, b2, c2, b2, d, c2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}
