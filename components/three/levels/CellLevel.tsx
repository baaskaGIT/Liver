'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { applyOpacity, collectMaterials, journey, levelTransform } from '@/lib/journey';
import { LEVELS } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';

// Hepatocyte: Baaska's Rodin model (a relief-style illustration, viewed from the front).
const URL = '/models/hepatocyte.glb';
const S = 1.5; // model scale in the scene
const C = new THREE.Vector3(0, 0.932, 0); // bbox centre of the model
const TILT = new THREE.Euler(0.12, -0.28, 0); // a slight turn so the relief reads as 3D
const PERO0 = new THREE.Vector3(0.372, 0.724, 0.055); // the lavender bubble = peroxisome we dive into (model space)
export const CELL_FOCUS = PERO0.clone().sub(C).multiplyScalar(S).applyEuler(TILT);

const HOTSPOTS: HotspotDef[] = [
  { id: 'mito', position: [-0.127, 0.544, 0.06] },
  { id: 'peroxisome', position: [0.372, 0.724, 0.07], enter: true },
  { id: 'nucleus', position: [-0.016, 0.965, 0.19] },
  { id: 'rer', position: [0.251, 0.986, 0.06] },
  { id: 'ser', position: [-0.294, 0.968, 0.06] },
  { id: 'golgi', position: [0.16, 0.658, 0.07] },
  { id: 'glycogen', position: [-0.266, 1.225, 0.06] },
  { id: 'canaliculus', position: [0.429, 1.387, 0.06] },
  { id: 'microvilli', position: [0.09, 1.448, 0.06] },
];

function CellModel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
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
    const o = levelTransform(3, journey.t, CELL_FOCUS, ref.current);
    applyOpacity(mats, o);
    if (ref.current.visible) inner.current.rotation.y = Math.sin(clock.elapsedTime * 0.15) * 0.04;
  });

  return (
    <group ref={ref}>
      <group rotation={TILT}>
        <group ref={inner}>
          <group scale={S}>
            <group position={[-C.x, -C.y, -C.z]}>
              <primitive object={model} />
              <Hotspots level={3} items={HOTSPOTS} labels={LEVELS[3].parts} selected={props.selected} onSelect={props.onSelect} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

export function CellLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  return (
    <Suspense fallback={null}>
      <CellModel {...props} />
    </Suspense>
  );
}
useGLTF.preload(URL);
