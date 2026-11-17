'use client';
import { Environment, Lightformer, Sparkles, useProgress } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { memo, Suspense, useRef } from 'react';
import * as THREE from 'three';
import { journey } from '@/lib/journey';
import type { HotspotDef } from './Hotspots';
import { BodyLevel } from './levels/BodyLevel';
import { LiverLevel } from './levels/LiverLevel';
import { LobuleLevel } from './levels/LobuleLevel';
import { CellLevel } from './levels/CellLevel';
import { PeroxisomeLevel } from './levels/PeroxisomeLevel';
import { CatalaseLevel } from './levels/CatalaseLevel';

/** How far the mouse turns each level left/right (radians): body, liver, lobule, cell, peroxisome, catalase */
const YAW = [0.28, Math.PI * 0.2, 0.28, 0.28, 0.28, Math.PI];

type Props = { selected: { level: number; id: string } | null; onSelect: (l: number, h: HotspotDef) => void };

/**
 * Once every model has loaded (behind the loading screen), compile all shaders and upload all textures,
 * including the levels that are still hidden. Otherwise each level does this the first time it appears,
 * which freezes the zoom for a moment.
 */
function Warmup() {
  const { gl, scene, camera } = useThree();
  const { active, progress } = useProgress();
  const done = useRef(false);
  const wait = useRef(0);
  useFrame(() => {
    if (done.current || active || progress < 100) return;
    if (++wait.current < 3) return; // let the environment map and the levels settle first
    done.current = true;
    const shown: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
    });
    // the post-processing renders the scene into an off-screen target, which needs its own shader variants
    const prev = gl.getRenderTarget();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    gl.setRenderTarget(rt);
    gl.compile(scene, camera);
    gl.setRenderTarget(prev);
    rt.dispose();
    const seen = new Set<THREE.Texture>();
    scene.traverse((o: any) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture && !seen.has(v)) seen.add(v);
        if (m.uniforms) for (const u of Object.values(m.uniforms) as any[]) if (u?.value instanceof THREE.Texture) seen.add(u.value);
      }
    });
    seen.forEach((t) => gl.initTexture(t));
    shown.forEach((o) => (o.visible = false));
  });
  return null;
}

export const Scene = memo(function Scene({ selected, onSelect }: Props) {
  const root = useRef<THREE.Group>(null!);
  const { size, camera } = useThree();

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 3.5);
    journey.t += (journey.target - journey.t) * k;
    if (Math.abs(journey.target - journey.t) < 1e-4) journey.t = journey.target;

    const aspect = size.width / size.height;
    const desktop = aspect > 1.05 && size.width > 820;
    const tx = desktop ? Math.min(1.1, 0.42 * aspect) : 0;
    const ty = desktop ? 0 : 0.42;
    root.current.position.x += (tx - root.current.position.x) * k;
    root.current.position.y += (ty - root.current.position.y) * k;
    // mouse turn per level: liver ±36°, catalase ±180°, others ±16°
    const lo = Math.min(Math.max(Math.floor(journey.t), 0), YAW.length - 1);
    const hi = Math.min(lo + 1, YAW.length - 1);
    const yaw = YAW[lo] + (YAW[hi] - YAW[lo]) * Math.min(Math.max(journey.t - lo, 0), 1);
    root.current.rotation.y += (journey.pointer.x * yaw - root.current.rotation.y) * k;
    root.current.rotation.x += (-journey.pointer.y * 0.12 - root.current.rotation.x) * k;
    // narrow screens: step back so the model fits
    const z = desktop ? 5 : 5 * Math.max(1, 0.85 / aspect);
    camera.position.z += (z - camera.position.z) * k;
  }, -1);

  const sel = (l: number) => (selected?.level === l ? selected.id : null);

  return (
    <>
      <color attach="background" args={['#04070d']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={2.1} />
      <directionalLight position={[-4, 1.5, -3]} intensity={1.4} color="#7fb8ff" />
      <pointLight position={[0, -3, 3]} intensity={6} color="#ff8a5c" distance={12} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 3, 4]} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#7fb8ff" position={[-5, 0, -2]} scale={[3, 6, 1]} />
        <Lightformer form="rect" intensity={1} color="#ff9a76" position={[5, -1, 1]} scale={[3, 3, 1]} />
      </Environment>
      <Warmup />
      <group ref={root}>
        <Suspense fallback={null}>
          <BodyLevel selected={sel(0)} onSelect={onSelect} />
          <LiverLevel selected={sel(1)} onSelect={onSelect} />
        </Suspense>
        <LobuleLevel selected={sel(2)} onSelect={onSelect} />
        <CellLevel selected={sel(3)} onSelect={onSelect} />
        <PeroxisomeLevel selected={sel(4)} onSelect={onSelect} />
        <CatalaseLevel selected={sel(5)} onSelect={onSelect} />
      </group>
      <Sparkles count={140} scale={[12, 7, 6]} size={1.6} speed={0.15} opacity={0.22} color="#9ecbff" />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.78} luminanceSmoothing={0.2} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </>
  );
});
