'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { applyOpacity, collectMaterials, journey, levelTransform } from '@/lib/journey';
import { LEVELS } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';

// Peroxisome: Baaska's Rodin model (cut open at the front), recoloured to match the cell's lavender bubble.
const URL = '/models/peroxisome.glb';
const S = 1.4; // model scale in the scene
const C = new THREE.Vector3(0, 0.937, 0); // bbox centre of the model
const TILT = new THREE.Euler(0.12, -0.3, 0); // a slight turn so the cut and the sphere both read
const DOT = new THREE.Vector3(-0.023, 0.908, 0.68); // the catalase molecule we dive into (model space)
export const PEROXISOME_FOCUS = DOT.clone().sub(C).multiplyScalar(S).applyEuler(TILT);

const HOTSPOTS: HotspotDef[] = [
  { id: 'catalase', position: [-0.023, 0.908, 0.72], enter: true },
  { id: 'membrane', position: [-0.718, 0.904, 0.64] },
  { id: 'matrix', position: [0.475, 0.71, 0.7] },
  { id: 'cluster', position: [0.077, 0.646, 0.8] },
  { id: 'pex', position: [0.78, 1.402, 0.4] },
];

function PeroxisomeModel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  const { scene } = useGLTF(URL);
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.traverse((o: any) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.envMapIntensity = 0.8;
      }
    });
    return m;
  }, [scene]);
  const mats = useMemo(() => collectMaterials(model), [model]);
  const ref = useRef<THREE.Group>(null!);
  const inner = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    const o = levelTransform(4, journey.t, PEROXISOME_FOCUS, ref.current);
    applyOpacity(mats, o);
    if (ref.current.visible) inner.current.rotation.y = Math.sin(clock.elapsedTime * 0.18) * 0.05;
  });

  return (
    <group ref={ref}>
      <group rotation={TILT}>
        <group ref={inner}>
          <group scale={S}>
            <group position={[-C.x, -C.y, -C.z]}>
              <primitive object={model} />
              <Hotspots level={4} items={HOTSPOTS} labels={LEVELS[4].parts} selected={props.selected} onSelect={props.onSelect} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

export function PeroxisomeLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  return (
    <Suspense fallback={null}>
      <PeroxisomeModel {...props} />
    </Suspense>
  );
}
useGLTF.preload(URL);
