'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyOpacity, collectMaterials, journey, levelTransform, rng } from '@/lib/journey';
import { LEVELS } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';

// Hexagonal liver lobules as a deep block of tissue: a mosaic of hepatocytes on top,
// blue sinusoids converging on the central vein, green bile canaliculi running outward,
// thin red arterioles, and portal triads standing at the corners.
const R = 1.25; // centre → corner
const APO = R * Math.cos(Math.PI / 6);
const H = 0.5; // block depth
const TOP = H / 2;
const GAP = 0.028; // crevice between neighbouring lobules
const TILT = new THREE.Euler(0.72, 0.35, 0);
const NSIN = 22; // sinusoids per lobule
const CELL = 0.062; // hepatocyte size on the surface
const CV_R = 0.1;

const C = {
  cell: '#e6c2a2',
  side: '#a87a5a',
  blue: '#5a6bd6',
  blueGlow: '#a9b6ff',
  green: '#4cc95c',
  greenGlow: '#b6ffa8',
  red: '#d9434f',
  redGlow: '#ffb0b0',
};

/** distance from centre to the hexagon edge along angle a (corners at 0°, 60°, …) */
const edgeDist = (a: number) => {
  const sector = (((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3));
  return APO / Math.cos(sector - Math.PI / 6);
};
const corner = (k: number, r = R) => new THREE.Vector3(r * Math.cos((k * Math.PI) / 3), 0, r * Math.sin((k * Math.PI) / 3));
const polar = (a: number, r: number, y: number, out = new THREE.Vector3()) => out.set(r * Math.cos(a), y, r * Math.sin(a));

/** angle of sinusoid k at radius r: wavy, but neighbours stay roughly parallel */
const sinA = (k: number, r: number) => {
  const a0 = ((k + 0.5) / NSIN) * Math.PI * 2;
  return a0 + (0.05 * Math.sin(r * 9 + k * 2.3) + 0.025 * Math.sin(r * 21 + k * 5.1)) * Math.min(1, r * 2.2);
};

// neighbouring lobule centres (hex tiling)
const CENTRES = [new THREE.Vector3(0, 0, 0), ...Array.from({ length: 6 }, (_, k) => polar(Math.PI / 6 + (k * Math.PI) / 3, 2 * APO, 0))];

/** tube along points with a radius that can vary along its length; uv.x runs 0→1 from the first point */
function tube(pts: THREE.Vector3[], seg: number, radial: number, rad: (t: number) => number) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = rad(i / seg);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  return g;
}

/** pillow-shaped tile: a box with soft rounded edges */
function tileGeometry() {
  const g = new THREE.SphereGeometry(0.5, 12, 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const k = Math.pow(Math.pow(Math.abs(v.x), 7) + Math.pow(Math.abs(v.y), 5) + Math.pow(Math.abs(v.z), 7), 1 / 7);
    v.divideScalar(k).multiplyScalar(0.5);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Material with a soft glow pulse travelling along the tube (uv.x), showing the direction of flow. */
function flowMaterial(key: string, color: string, glow: string, opts: { speed: number; freq: number; amp: number }) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') });
  m.defines = { ...(m.defines || {}), USE_UV: '' };
  const uTime = { value: 0 };
  const g = new THREE.Color(glow);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fph = fract(vUv.x * ${opts.freq.toFixed(2)} - uTime * ${opts.speed.toFixed(3)});
        float fpulse = smoothstep(0.0, 0.06, fph) * (1.0 - smoothstep(0.06, 0.32, fph));
        totalEmissiveRadiance += vec3(${g.r.toFixed(3)}, ${g.g.toFixed(3)}, ${g.b.toFixed(3)}) * fpulse * ${opts.amp.toFixed(2)};`,
      );
  };
  m.customProgramCacheKey = () => 'flow-' + key;
  return { m, uTime };
}

/** side texture: rows of cells seen on the cut faces of the block */
function sideTexture() {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#5a3a28';
  ctx.fillRect(0, 0, 256, 256);
  const rand = rng(99);
  const s = 32;
  for (let y = 0; y < 256; y += s) {
    const off = (y / s) % 2 ? s / 2 : 0;
    for (let x = -s; x < 256 + s; x += s) {
      const l = 62 + rand() * 14;
      ctx.fillStyle = `hsl(${24 + rand() * 6}, ${38 + rand() * 10}%, ${l}%)`;
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(x + off + 2, y + 2, s - 4, s - 4, 6) : ctx.rect(x + off + 2, y + 2, s - 4, s - 4);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** hexagonal prism (sides only + top), slightly inset so neighbouring lobules leave a crevice */
function blockGeometry() {
  const Rb = R - GAP / Math.cos(Math.PI / 6);
  const pos: number[] = [];
  const uv: number[] = [];
  let u = 0;
  for (let k = 0; k < 6; k++) {
    const a = corner(k, Rb), b = corner(k + 1, Rb);
    const len = a.distanceTo(b);
    const u0 = u, u1 = u + len;
    u = u1;
    const quad = [
      [a, -H / 2, u0, 0], [b, -H / 2, u1, 0], [b, H / 2, u1, H],
      [a, -H / 2, u0, 0], [b, H / 2, u1, H], [a, H / 2, u0, H],
    ] as const;
    for (const [p, y, uu, vv] of quad) {
      pos.push(p.x, y, p.z);
      uv.push(uu * 4, vv * 4);
    }
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sides.computeVertexNormals();
  const top = new THREE.CircleGeometry(Rb, 6);
  top.rotateX(-Math.PI / 2);
  top.translate(0, TOP - 0.004, 0);
  return { sides, top };
}

type Tile = { p: THREE.Vector3; rot: number; w: number; d: number; c: THREE.Color };

/** fill the spaces between sinusoids with hepatocyte tiles (an even number across, so a canaliculus sits between them) */
function buildTiles(seed: number) {
  const rand = rng(seed);
  const tiles: Tile[] = [];
  const base = new THREE.Color(C.cell);
  const STEP = CELL * 1.02;
  for (let k = 0; k < NSIN; k++) {
    for (let r = CV_R + 0.07; r < R; r += STEP) {
      let a0 = sinA(k, r), a1 = sinA(k + 1, r);
      if (a1 < a0) a1 += Math.PI * 2;
      const margin = 0.022 / r;
      const w = (a1 - a0 - 2 * margin) * r;
      if (w < CELL * 0.3) continue;
      const n = w < CELL * 1.5 ? 1 : 2 * Math.max(1, Math.round(w / (CELL * 2)));
      for (let i = 0; i < n; i++) {
        const a = a0 + margin + ((i + 0.5) / n) * (a1 - a0 - 2 * margin);
        const lim = edgeDist(a) - 0.06;
        let d = STEP * 0.97;
        let rr = r;
        if (r + d / 2 > lim) {
          d = lim - (r - d / 2);
          rr = r - STEP * 0.45 + d / 2;
          if (d < 0.025) continue;
        }
        const c = base.clone().offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.08);
        if (rand() < 0.12) c.offsetHSL(-0.02, 0.05, -0.04);
        tiles.push({ p: polar(a + (rand() - 0.5) * 0.004, rr + (rand() - 0.5) * 0.004, TOP + 0.012 + rand() * 0.004), rot: a, w: (w / n) * 0.95, d: d * 0.97, c });
      }
    }
  }
  return tiles;
}

// the main lobule's tiles are built up front so the dive target is a real cell
const MAIN_TILES = buildTiles(7);
const FOCUS_INDEX = (() => {
  const target = polar(2.2, 0.78, TOP);
  let best = 0, bd = Infinity;
  MAIN_TILES.forEach((t, i) => {
    const d = t.p.distanceToSquared(target);
    if (d < bd) (bd = d), (best = i);
  });
  return best;
})();
const FOCUS_INNER = MAIN_TILES[FOCUS_INDEX].p.clone();
export const LOBULE_FOCUS = FOCUS_INNER.clone().applyEuler(TILT);

/** geometry shared by every lobule (in lobule-local space) */
function lobuleNetwork() {
  const sin: THREE.BufferGeometry[] = [];
  for (let k = 0; k < NSIN; k++) {
    const pts: THREE.Vector3[] = [];
    const a = ((k + 0.5) / NSIN) * Math.PI * 2;
    const rEnd = edgeDist(sinA(k, R)) - 0.012;
    for (let i = 0; i <= 24; i++) {
      const r = rEnd + (CV_R + 0.02 - rEnd) * (i / 24);
      pts.push(polar(sinA(k, r), r, TOP + 0.024));
    }
    void a;
    sin.push(tube(pts, 60, 8, (t) => 0.0155 + 0.008 * Math.pow(t, 3)));
  }
  const bile: THREE.BufferGeometry[] = [];
  for (let k = 0; k < NSIN; k++) {
    const pts: THREE.Vector3[] = [];
    const mid = (r: number) => {
      let a0 = sinA(k, r), a1 = sinA(k + 1, r);
      if (a1 < a0) a1 += Math.PI * 2;
      return (a0 + a1) / 2;
    };
    const r0 = 2 * CELL / ((Math.PI * 2) / NSIN - 0.054 / 0.5) * 0.85;
    for (let i = 0; i <= 16; i++) {
      const r = Math.max(0.3, r0) + (edgeDist(mid(R)) - 0.05 - Math.max(0.3, r0)) * (i / 16);
      pts.push(polar(mid(r), r, TOP + 0.034));
    }
    bile.push(tube(pts, 40, 5, () => 0.0058));
  }
  // green bile ductule running round the lobule just inside its edge
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    ring.push(polar(a, edgeDist(a) - 0.048, TOP + 0.03));
  }
  bile.push(tube(ring, 240, 5, () => 0.0075));
  return { sin: mergeGeometries(sin), bile: mergeGeometries(bile) };
}

/** corners and edges shared between lobules (deduplicated) */
function sharedNetwork() {
  const corners: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 8)},${Math.round(v.z * 8)}`;
  const seen = new Set<string>();
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  const eSeen = new Set<string>();
  CENTRES.forEach((c) => {
    for (let k = 0; k < 6; k++) {
      const a = corner(k).add(c), b = corner(k + 1).add(c);
      if (!seen.has(key(a))) (seen.add(key(a)), corners.push(a));
      const ek = [key(a), key(b)].sort().join('|');
      if (!eSeen.has(ek)) (eSeen.add(ek), edges.push([a, b]));
    }
  });
  const rand = rng(17);
  // interlobular vein branches along every edge, linking the portal veins
  const veins: THREE.BufferGeometry[] = [];
  edges.forEach(([a, b]) => {
    const pts: THREE.Vector3[] = [];
    const n = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize();
    const ph = rand() * 6;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(a.clone().lerp(b, t).addScaledVector(n, 0.012 * Math.sin(t * 9 + ph)).setY(TOP + 0.024));
    }
    veins.push(tube(pts, 40, 8, (t) => 0.024 - 0.007 * Math.sin(t * Math.PI)));
  });
  // thin red arterioles wandering out from every hepatic artery across the surface
  const arts: THREE.BufferGeometry[] = [];
  corners.forEach((cp) => {
    const nb = 3 + Math.floor(rand() * 2);
    for (let j = 0; j < nb; j++) {
      const pts: THREE.Vector3[] = [cp.clone().setY(TOP + 0.045)];
      let dir = rand() * Math.PI * 2;
      const p = cp.clone();
      const len = 0.25 + rand() * 0.35;
      const steps = 9;
      for (let i = 1; i <= steps; i++) {
        dir += (rand() - 0.5) * 1.1;
        p.add(new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)).multiplyScalar(len / steps));
        pts.push(p.clone().setY(TOP + 0.04));
      }
      arts.push(tube(pts, 40, 5, (t) => 0.0058 * (1 - 0.45 * t)));
    }
  });
  return { corners, veins: mergeGeometries(veins), arts: mergeGeometries(arts) };
}

/** central vein: a blue cup flaring into the surface where the sinusoids drain */
function centralVeinGeometry() {
  const prof = [
    new THREE.Vector2(CV_R, -H / 2),
    new THREE.Vector2(CV_R, TOP - 0.03),
    new THREE.Vector2(CV_R + 0.07, TOP + 0.005),
    new THREE.Vector2(CV_R + 0.1, TOP + 0.02),
    new THREE.Vector2(CV_R + 0.06, TOP + 0.03),
    new THREE.Vector2(CV_R + 0.035, TOP + 0.06),
    new THREE.Vector2(CV_R + 0.03, TOP + 0.085),
    new THREE.Vector2(CV_R + 0.018, TOP + 0.095),
    new THREE.Vector2(CV_R + 0.004, TOP + 0.088),
    new THREE.Vector2(CV_R - 0.002, TOP + 0.06),
    new THREE.Vector2(CV_R - 0.004, -H / 2),
  ];
  const g = new THREE.LatheGeometry(prof, 48);
  g.computeVertexNormals();
  return g;
}

/** an open-ended vessel standing up out of the tissue */
function Vessel(props: { position: THREE.Vector3; r: number; wall: number; h: number; color: string; lumen: string }) {
  const { r, wall, h } = props;
  return (
    <group position={props.position}>
      <mesh position={[0, (h - H) / 2 - 0.0, 0]}>
        <cylinderGeometry args={[r, r * 1.08, h, 32, 1, true]} />
        <meshPhysicalMaterial color={props.color} roughness={0.38} clearcoat={0.5} clearcoatRoughness={0.35} sheen={0.6} sheenColor="#ffffff" />
      </mesh>
      <mesh position={[0, (h - H) / 2, 0]}>
        <cylinderGeometry args={[r - wall, r - wall, h, 32, 1, true]} />
        <meshStandardMaterial color={props.lumen} roughness={0.7} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, h - H / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r - wall, r, 32]} />
        <meshPhysicalMaterial color={props.color} roughness={0.4} clearcoat={0.5} />
      </mesh>
    </group>
  );
}

export function LobuleLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  const ref = useRef<THREE.Group>(null!);
  const inner = useRef<THREE.Group>(null!);

  const flows = useMemo(
    () => ({
      sin: flowMaterial('sin', C.blue, C.blueGlow, { speed: 0.22, freq: 2, amp: 0.35 }),
      bile: flowMaterial('bile', C.green, C.greenGlow, { speed: 0.14, freq: 2, amp: 0.3 }),
      art: flowMaterial('art', C.red, C.redGlow, { speed: 0.35, freq: 1.5, amp: 0.35 }),
      vein: flowMaterial('vein', C.blue, C.blueGlow, { speed: 0.12, freq: 1, amp: 0.15 }),
    }),
    [],
  );

  // hepatocyte mosaic for all seven lobules in one instanced mesh
  const tiles = useMemo(() => {
    const all: Tile[] = [];
    CENTRES.forEach((c, li) => {
      const list = li === 0 ? MAIN_TILES : buildTiles(7 + li * 13);
      list.forEach((t, i) => {
        const tt = { ...t, p: t.p.clone().add(c) };
        if (li === 0 && i === FOCUS_INDEX) tt.c = new THREE.Color('#f3d2ae');
        all.push(tt);
      });
    });
    const mesh = new THREE.InstancedMesh(tileGeometry(), new THREE.MeshPhysicalMaterial({ roughness: 0.62, sheen: 0.8, sheenRoughness: 0.45, sheenColor: new THREE.Color('#fff1dc'), clearcoat: 0.08 }), all.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    all.forEach((t, i) => {
      q.setFromAxisAngle(up, -t.rot);
      m.compose(t.p, q, new THREE.Vector3(t.d, 0.042, t.w));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, t.c);
    });
    return mesh;
  }, []);

  const block = useMemo(() => {
    const g = blockGeometry();
    const tex = sideTexture();
    const sideMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: 0.8, side: THREE.DoubleSide });
    const topMat = new THREE.MeshStandardMaterial({ color: '#6e4a34', roughness: 0.9 });
    return { ...g, sideMat, topMat };
  }, []);

  const net = useMemo(lobuleNetwork, []);
  const shared = useMemo(sharedNetwork, []);
  const cv = useMemo(centralVeinGeometry, []);

  const kupffer = useMemo(() => {
    const rand = rng(5);
    return Array.from({ length: 9 }, () => {
      const k = Math.floor(rand() * NSIN);
      const r = 0.35 + rand() * 0.6;
      return polar(sinA(k, r), r, TOP + 0.034);
    });
  }, []);

  const mats = useRef<ReturnType<typeof collectMaterials> | null>(null);

  useFrame(({ clock }) => {
    const o = levelTransform(2, journey.t, LOBULE_FOCUS, ref.current);
    if (!mats.current) mats.current = collectMaterials(inner.current);
    applyOpacity(mats.current, o);
    if (!ref.current.visible) return;
    const t = clock.elapsedTime;
    flows.sin.uTime.value = t;
    flows.bile.uTime.value = t;
    flows.art.uTime.value = t;
    flows.vein.uTime.value = t;
  });

  const hotspots: HotspotDef[] = useMemo(() => {
    const triad = corner(1).setY(TOP + 0.2);
    const k = kupffer[0];
    const sinP = polar(sinA(3, 0.8), 0.8, TOP + 0.03);
    const bm = (sinA(14, 0.62) + sinA(15, 0.62)) / 2;
    return [
      { id: 'plate', position: FOCUS_INNER.clone().setY(TOP + 0.03).toArray() as [number, number, number], enter: true },
      { id: 'central', position: [0, TOP + 0.11, 0] },
      { id: 'triad', position: triad.toArray() as [number, number, number] },
      { id: 'sinusoid', position: sinP.toArray() as [number, number, number] },
      { id: 'kupffer', position: [k.x, k.y + 0.02, k.z] },
      { id: 'bile', position: polar(bm, 0.62, TOP + 0.03).toArray() as [number, number, number] },
    ];
  }, [kupffer]);

  return (
    <group ref={ref}>
      <group rotation={TILT}>
        <group ref={inner}>
          <primitive object={tiles} />
          {CENTRES.map((c, i) => (
            <group key={i} position={c}>
              <mesh geometry={block.sides} material={block.sideMat} />
              <mesh geometry={block.top} material={block.topMat} />
              <mesh geometry={net.sin} material={flows.sin.m} />
              <mesh geometry={net.bile} material={flows.bile.m} />
              <mesh geometry={cv}>
                <meshPhysicalMaterial color={C.blue} roughness={0.35} clearcoat={0.6} clearcoatRoughness={0.3} sheen={0.6} sheenColor="#ffffff" side={THREE.DoubleSide} />
              </mesh>
              <mesh position={[0, TOP + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[CV_R - 0.003, 40]} />
                <meshStandardMaterial color="#1c1f5c" roughness={0.9} />
              </mesh>
            </group>
          ))}
          <mesh geometry={shared.veins} material={flows.vein.m} />
          <mesh geometry={shared.arts} material={flows.art.m} />
          {/* portal triads at every corner: portal vein (blue), bile duct (green), hepatic artery (red) */}
          {shared.corners.map((cp, i) => {
            const a = Math.atan2(cp.z, cp.x) + i * 0.7;
            const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            const side2 = new THREE.Vector3(Math.cos(a + 2.1), 0, Math.sin(a + 2.1));
            return (
              <group key={i}>
                <Vessel position={cp} r={0.05} wall={0.008} h={H + 0.1} color={C.blue} lumen="#1d2266" />
                <Vessel position={cp.clone().addScaledVector(side, 0.085)} r={0.036} wall={0.007} h={H + 0.13} color={C.green} lumen="#0f4a1a" />
                <Vessel position={cp.clone().addScaledVector(side2, 0.075)} r={0.025} wall={0.006} h={H + 0.09} color={C.red} lumen="#4a0a10" />
              </group>
            );
          })}
          {/* Kupffer cells sitting on the sinusoids */}
          {kupffer.map((p, i) => (
            <mesh key={i} position={p} scale={[1.3, 0.7, 1.3]}>
              <icosahedronGeometry args={[0.02, 1]} />
              <meshPhysicalMaterial color="#f2c14e" roughness={0.45} sheen={0.6} sheenColor="#fff3c4" />
            </mesh>
          ))}
        </group>
        <Hotspots level={2} items={hotspots} labels={LEVELS[2].parts} selected={props.selected} onSelect={props.onSelect} />
      </group>
    </group>
  );
}
