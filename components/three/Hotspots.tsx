'use client';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { journey, settled } from '@/lib/journey';

const PARKED = [-10000, -10000];
const tmp = new THREE.Vector3();

export type HotspotDef = { id: string; position: [number, number, number]; enter?: boolean };

type Props = {
  level: number;
  items: HotspotDef[];
  labels: Record<string, { name: string }>;
  selected?: string | null;
  onSelect: (level: number, h: HotspotDef) => void;
};

/** Clickable labels pinned to 3D points. They appear only while the journey rests on their level. */
export function Hotspots({ level, items, labels, selected, onSelect }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const last = useRef('');
  useFrame(() => {
    const s = settled(level, journey.t);
    // only touch the DOM when something changed, so hidden labels cost nothing while scrolling
    const op = s.toFixed(3);
    // labels mount a little later than the scene, so also redo it when a new one has appeared
    const key = op + ':' + refs.current.filter(Boolean).length;
    if (key === last.current) return;
    last.current = key;
    for (const el of refs.current) {
      if (!el) continue;
      el.style.opacity = op;
      el.style.pointerEvents = s > 0.6 ? 'auto' : 'none';
      el.style.visibility = s < 0.02 ? 'hidden' : 'visible';
    }
  });
  // while the labels are hidden, park them so drei does not re-position them every frame
  const calc = useCallback(
    (obj: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) => {
      if (settled(level, journey.t) < 0.02) return PARKED;
      const v = tmp.setFromMatrixPosition(obj.matrixWorld).project(camera);
      return [(v.x * size.width) / 2 + size.width / 2, -(v.y * size.height) / 2 + size.height / 2];
    },
    [level],
  );
  return (
    <>
      {items.map((h, i) => (
        <Html key={h.id} position={h.position} calculatePosition={calc} zIndexRange={[30, 10]} style={{ pointerEvents: 'none' }}>
          <button
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`hotspot${h.enter ? ' enter' : ''}${selected === h.id ? ' active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(level, h);
            }}
            style={{ visibility: 'hidden', opacity: 0 }}
          >
            <span className="dot" />
            <span className="label">
              {labels[h.id]?.name}
              {h.enter && <span className="go"> ↘</span>}
            </span>
          </button>
        </Html>
      ))}
    </>
  );
}
