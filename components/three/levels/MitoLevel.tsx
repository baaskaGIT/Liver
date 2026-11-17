'use client';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { applyOpacity, collectMaterials, journey, levelTransform, rng } from '@/lib/journey';
import { LEVELS } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';

// Mitochondrion: Baaska's Rodin model, a cutaway showing the cristae and matrix.
const URL = '/models/mitochondrion.glb';
const S = 1.3; // model scale in the scene
const C = new THREE.Vector3(0, 0.354, 0); // bbox centre of the model
const TILT_X = 0.7; // look down into the cut
const TURN_Y = Math.PI / 2; // long axis across the screen
const ATP = 70; // glowing ATP particles streaming out of the mitochondrion
const ATP_LEN = 2.0; // spread along the long axis

const HOTSPOTS: HotspotDef[] = [
  { id: 'outer', position: [-0.238, 0.625, -0.674] },
  { id: 'cristae', position: [0.454, 0.239, 0.134] },
  { id: 'matrix', position: [-0.241, 0.383, 0.021] },
  { id: 'atp', position: [0.094, 0.32, 0.31] },
  { id: 'dna', position: [0.159, 0.351, 0.58] },
];

function MitoModel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
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
  const atp = useMemo(() => {
    const rand = rng(91);
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.03, 1), new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffd60a', emissiveIntensity: 2.2 }), ATP);
    const data = Array.from({ length: ATP }, () => ({ x: (rand() - 0.5) * ATP_LEN, a: rand() * Math.PI * 2, phase: rand(), speed: 0.12 + rand() * 0.1 }));
    return { mesh, data };
  }, []);
  const mats = useMemo(() => [...collectMaterials(model), ...collectMaterials(atp.mesh)], [model, atp]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), s: new THREE.Vector3() }), []);
  const ref = useRef<THREE.Group>(null!);
  const inner = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    const o = levelTransform(4, journey.t, new THREE.Vector3(), ref.current);
    applyOpacity(mats, o);
    if (!ref.current.visible) return;
    const t = clock.elapsedTime;
    inner.current.rotation.y = Math.sin(t * 0.2) * 0.06;
    atp.data.forEach((d, i) => {
      const f = (t * d.speed + d.phase) % 1;
      const r = 0.12 + f * 1.2; // from the matrix outwards, through the membranes, into the cell
      const sc = f < 0.08 ? f / 0.08 : f > 0.85 ? (1 - f) / 0.15 : 1;
      tmp.m.makeTranslation(d.x, r * Math.cos(d.a), r * Math.sin(d.a));
      tmp.m.scale(tmp.s.set(sc, sc, sc));
      atp.mesh.setMatrixAt(i, tmp.m);
    });
    atp.mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={ref}>
      <group rotation={[TILT_X, 0, 0]}>
        <group ref={inner}>
          <primitive object={atp.mesh} />
          <group rotation={[0, TURN_Y, 0]} scale={S}>
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

export function MitoLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  return (
    <Suspense fallback={null}>
      <MitoModel {...props} />
    </Suspense>
  );
}
useGLTF.preload(URL);
