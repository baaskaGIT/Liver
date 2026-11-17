import * as THREE from 'three';
import type { LiverState } from '@/content/levels';

/** Zoom factor between level i and i+1 (body→liver is matched so the liver sizes line up). */
export const ZOOM = [3.82, 9, 10.38, 37.4, 23.8]; // body, cell, peroxisome, catalase drawn larger: zooms adjusted so each level still lands on the previous one
export const LEVEL_COUNT = 6;

/** Shared, mutable journey state read every frame by the 3D scene (no React re-renders). */
export const journey = {
  target: 0, // from scroll
  t: 0, // smoothed
  liverState: 'healthy' as LiverState,
  pointer: new THREE.Vector2(),
};

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const smoothstep = ss;

/**
 * Where a level is during the journey. local = t - i.
 * Before its turn a level is tiny at the centre, at its turn it is 1:1,
 * after its turn it grows and slides so that its focus point (the next level) stays centred.
 */
export function levelTransform(i: number, t: number, focus: THREE.Vector3, out: THREE.Object3D) {
  const local = t - i;
  let s = 1;
  let w = 0;
  if (local >= 0) {
    const k = ZOOM[i] ?? 1;
    s = Math.pow(k, Math.min(local, 1.2));
    w = ss(0, 0.5, local);
  } else {
    const k = ZOOM[i - 1] ?? 1;
    s = Math.pow(k, Math.max(local, -1.2));
  }
  out.scale.setScalar(s);
  out.position.copy(focus).multiplyScalar(-s * w);
  const fadeIn = i === 0 ? 1 : ss(-0.45, -0.1, local);
  const fadeOut = i === LEVEL_COUNT - 1 ? 1 : 1 - ss(0.55, 0.9, local);
  const o = Math.min(fadeIn, fadeOut);
  out.visible = o > 0.003;
  return o;
}

/** How "settled" a level is (1 when the journey rests on it). Used to show labels. */
export const settled = (i: number, t: number) => 1 - ss(0.04, 0.16, Math.abs(t - i));

type MatEntry = { m: THREE.Material & { opacity: number; uniforms?: any }; base: number; transparent: boolean; depthWrite: boolean };

export function collectMaterials(root: THREE.Object3D): MatEntry[] {
  const list: MatEntry[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((o: any) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      const base = m.uniforms?.uOpacity ? m.uniforms.uOpacity.value : m.opacity ?? 1;
      list.push({ m, base, transparent: m.transparent, depthWrite: m.depthWrite });
    }
  });
  return list;
}

export function applyOpacity(list: MatEntry[], o: number) {
  for (const e of list) {
    const m = e.m;
    if (m.uniforms?.uOpacity) {
      m.uniforms.uOpacity.value = e.base * o;
      continue;
    }
    m.opacity = e.base * o;
    m.transparent = e.transparent || o < 0.999;
    m.depthWrite = e.depthWrite && (e.transparent ? true : o > 0.35);
  }
}

/** Soft additive rim-light material used for membranes, glass and glows. */
export function fresnelMaterial(color: string, { power = 2.2, intensity = 1.2, base = 0.04, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uBase: { value: base },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity; uniform float uBase; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        float a = (f * uIntensity + uBase) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Radial glow texture for sprites. */
let glowTex: THREE.Texture | null = null;
export function getGlowTexture() {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Deterministic random for reproducible procedural models. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
