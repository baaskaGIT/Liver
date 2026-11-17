'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { applyOpacity, collectMaterials, getGlowTexture, journey, levelTransform } from '@/lib/journey';
import { LEVELS } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';

const URL = '/models/body-torso.glb';
const S = 1.485; // model scale in the scene
const C = new THREE.Vector3(0, 0.948, 0); // bbox centre of the torso model
const LIVER = new THREE.Vector3(-0.08, 0.905, 0.22); // liver centre inside the torso (model space)
export const BODY_FOCUS = LIVER.clone().sub(C).multiplyScalar(S);

const HOTSPOTS: HotspotDef[] = [
  { id: 'liver', position: [-0.103, 0.896, 0.33], enter: true },
  { id: 'heart', position: [0.017, 1.219, 0.37] },
  { id: 'lung', position: [-0.246, 1.229, 0.24] },
  { id: 'stomach', position: [0.261, 0.861, 0.28] },
  { id: 'intestine', position: [0, 0.526, 0.39] },
];

export function BodyLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  const { scene } = useGLTF(URL);
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.traverse((o: any) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.envMapIntensity = 0.7;
      }
    });
    return m;
  }, [scene]);
  const mats = useMemo(() => collectMaterials(model), [model]);
  const ref = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Sprite>(null!);

  useFrame(({ clock }) => {
    const o = levelTransform(0, journey.t, BODY_FOCUS, ref.current);
    applyOpacity(mats, o);
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.2);
    // the liver glow fades away as we fly in
    const nearTurn = 1 - Math.min(1, Math.max(0, journey.t * 2.5));
    (glow.current.material as THREE.SpriteMaterial).opacity = o * nearTurn * (0.18 + 0.22 * pulse);
  });

  return (
    <group ref={ref}>
      <group scale={S}>
        <group position={[-C.x, -C.y, -C.z]}>
          <primitive object={model} />
          <sprite ref={glow} position={LIVER.toArray()} scale={[0.75, 0.42, 1]} renderOrder={5}>
            <spriteMaterial map={getGlowTexture()} color="#ff8a5c" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
          <Hotspots level={0} items={HOTSPOTS} labels={LEVELS[0].parts} selected={props.selected} onSelect={props.onSelect} />
        </group>
      </group>
    </group>
  );
}
useGLTF.preload(URL);
