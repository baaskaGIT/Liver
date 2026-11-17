'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { applyOpacity, collectMaterials, journey, levelTransform } from '@/lib/journey';
import { LEVELS, type LiverState } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';

const URLS: Record<LiverState, string> = {
  healthy: '/models/liver-healthy.glb',
  fatty: '/models/liver-fatty.glb',
  cirrhosis: '/models/liver-cirrhosis.glb',
};
const S = 1.55;
const C = new THREE.Vector3(0, 1.0, 0.02); // centre of the liver body (model space)
const ROT = new THREE.Euler(0, Math.PI / 2 - 0.3, 0); // model front is -X, turn it to the camera (minus ~17° so it faces straight on)
const DIVE = new THREE.Vector3(-0.512, 1.001, -0.352); // point on the right lobe we dive into

const toLevel = (p: THREE.Vector3) => p.clone().sub(C).applyEuler(ROT).multiplyScalar(S);
export const LIVER_FOCUS = toLevel(DIVE);

const HOTSPOTS: HotspotDef[] = [
  { id: 'rightLobe', position: [-0.5, 1.0, -0.36], enter: true },
  { id: 'leftLobe', position: [-0.42, 1.163, 0.562] },
  { id: 'falciform', position: [-0.366, 1.2, 0.244] },
  { id: 'gallbladder', position: [-0.037, 0.671, 0.258] },
  { id: 'portal', position: [0.023, 0.527, 0.023] },
  { id: 'artery', position: [-0.052, 0.468, 0.305] },
  { id: 'ivc', position: [-0.036, 1.728, 0.001] },
];

function useVariant(url: string) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const m = scene.clone(true);
    m.traverse((o: any) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.envMapIntensity = 0.8;
      }
    });
    return { model: m, mats: collectMaterials(m) };
  }, [scene]);
}

export function LiverLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  const variants = {
    healthy: useVariant(URLS.healthy),
    fatty: useVariant(URLS.fatty),
    cirrhosis: useVariant(URLS.cirrhosis),
  };
  const ref = useRef<THREE.Group>(null!);
  const mix = useRef<Record<LiverState, number>>({ healthy: 1, fatty: 0, cirrhosis: 0 });

  useFrame((_, dt) => {
    const o = levelTransform(1, journey.t, LIVER_FOCUS, ref.current);
    const k = 1 - Math.exp(-dt * 5);
    (Object.keys(variants) as LiverState[]).forEach((s) => {
      const target = journey.liverState === s ? 1 : 0;
      mix.current[s] += (target - mix.current[s]) * k;
      const w = mix.current[s];
      variants[s].model.visible = w > 0.01;
      applyOpacity(variants[s].mats, o * w);
    });
  });

  return (
    <group ref={ref}>
      <group scale={S}>
        <group rotation={ROT}>
          <group position={[-C.x, -C.y, -C.z]}>
            <primitive object={variants.healthy.model} />
            <primitive object={variants.fatty.model} />
            <primitive object={variants.cirrhosis.model} />
            <Hotspots level={1} items={HOTSPOTS} labels={LEVELS[1].parts} selected={props.selected} onSelect={props.onSelect} />
          </group>
        </group>
      </group>
    </group>
  );
}
Object.values(URLS).forEach((u) => useGLTF.preload(u));
