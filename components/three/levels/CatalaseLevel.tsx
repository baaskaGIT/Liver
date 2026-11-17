'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { applyOpacity, collectMaterials, getGlowTexture, journey, levelTransform, rng } from '@/lib/journey';
import { cartoonGeometry, type ResRow } from '@/lib/cartoon';
import { LEVELS } from '@/content/levels';
import { Hotspots, type HotspotDef } from '../Hotspots';
import data from '@/lib/catalase-1dgf.json';

// Catalase: built in code from the real structure of human catalase (RCSB PDB 1DGF).
// Four identical subunits (tetramer), each with a heme group (iron in the middle) and an NADPH.
const A = 0.0259; // scene units per Ångström (the molecule is ~100 Å across)
const LEVEL = 5;
const CHAIN_COLORS: Record<string, string> = { A: '#5fd47a', B: '#ff7f3f', C: '#4aa3ff', D: '#ffc94a' };
const ELEMENT: Record<string, string> = { C: '#a9b1ba', N: '#5b82ff', O: '#ff5a5a', P: '#ffa53a', FE: '#ff9a3c' };
const MOL = 18; // H2O2 molecules in the reaction animation
const MOL_SCALE = 2.6; // draw the small molecules larger than life so they can be seen
const START_R = 75; // Å, where substrates appear / products disappear

type Het = [string, string, string, string, number, number, number];

function CatalaseModel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  const ref = useRef<THREE.Group>(null!);
  const inner = useRef<THREE.Group>(null!);

  const built = useMemo(() => {
    const chains = data.chains as unknown as Record<string, ResRow[]>;
    const het = data.het as unknown as Het[];
    const group = new THREE.Group();

    // ribbons
    const ribbonMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 1.2 });
    // a soft self-glow in each ribbon's own colour so the chains stay bright on the dark background
    ribbonMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.28;');
    };
    for (const [id, rows] of Object.entries(chains)) {
      const mesh = new THREE.Mesh(cartoonGeometry(rows, new THREE.Color(CHAIN_COLORS[id])), ribbonMat);
      group.add(mesh);
    }

    // heme + NADPH atoms
    const byEl: Record<string, THREE.Vector3[]> = {};
    for (const h of het) {
      const el = h[3] === 'FE' ? 'FE' : h[3];
      (byEl[el] ||= []).push(new THREE.Vector3(h[4], h[5], h[6]));
    }
    const m4 = new THREE.Matrix4();
    for (const [el, pts] of Object.entries(byEl)) {
      const r = el === 'FE' ? 1.15 : 0.62;
      const mat = new THREE.MeshStandardMaterial({
        color: ELEMENT[el] ?? '#cccccc',
        roughness: 0.35,
        emissive: el === 'FE' ? '#ff7a1a' : '#000000',
        emissiveIntensity: el === 'FE' ? 2.4 : 0,
      });
      const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(r, 2), mat, pts.length);
      pts.forEach((p, i) => inst.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
      group.add(inst);
    }

    // iron glows
    const irons = het.filter((h) => h[3] === 'FE').map((h) => new THREE.Vector3(h[4], h[5], h[6]));
    const glowMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: '#ff8a3c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
    for (const p of irons) {
      const s = new THREE.Sprite(glowMat);
      s.position.copy(p);
      s.scale.setScalar(9);
      group.add(s);
    }

    // hotspot anchors: the front-most iron and NADPH, and a point on subunit A
    const front = (v: THREE.Vector3) => v.z + v.x * 0.2;
    const fe = irons.slice().sort((a, b) => front(b) - front(a))[0];
    const ndpByChain: Record<string, THREE.Vector3[]> = {};
    for (const h of het) if (h[0] === 'NDP') (ndpByChain[h[1]] ||= []).push(new THREE.Vector3(h[4], h[5], h[6]));
    const ndp = Object.values(ndpByChain)
      .map((pts) => pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length))
      .sort((a, b) => front(b) - front(a))[0];
    const caA = chains.A.map((r) => new THREE.Vector3(r[1], r[2], r[3]));
    const sub = caA.slice().sort((a, b) => front(b) + b.y * 0.3 - (front(a) + a.y * 0.3))[0];

    return { group, irons, fe, ndp, sub };
  }, []);

  // H2O2 -> H2O + O2 animation
  const anim = useMemo(() => {
    const rand = rng(1957);
    const oMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75 * MOL_SCALE, 2), new THREE.MeshStandardMaterial({ color: '#ff4d4d', roughness: 0.3, emissive: '#ff2020', emissiveIntensity: 0.35 }), MOL * 2);
    const hMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5 * MOL_SCALE, 2), new THREE.MeshStandardMaterial({ color: '#f4f7fb', roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.25 }), MOL * 2);
    const dir = () => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const slots = Array.from({ length: MOL }, (_, i) => ({
      heme: i % 4,
      phase: rand(),
      speed: 0.07 + rand() * 0.04,
      from: dir().multiplyScalar(START_R),
      to: dir().multiplyScalar(START_R),
      spin: new THREE.Vector3(rand(), rand(), rand()).normalize(),
      cycle: -1,
      water: i % 2 === 0,
    }));
    return { oMesh, hMesh, slots, dir };
  }, []);

  const mats = useMemo(() => [...collectMaterials(built.group), ...collectMaterials(anim.oMesh), ...collectMaterials(anim.hMesh)], [built, anim]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), v: new THREE.Vector3() }), []);

  useFrame(({ clock }) => {
    const o = levelTransform(LEVEL, journey.t, new THREE.Vector3(), ref.current);
    applyOpacity(mats, o);
    if (!ref.current.visible) return;
    const t = clock.elapsedTime;
    inner.current.rotation.y = Math.sin(t * 0.16) * 0.35;
    inner.current.rotation.x = Math.sin(t * 0.11) * 0.08;

    const { oMesh, hMesh, slots } = anim;
    const hide = tmp.m.makeScale(0, 0, 0).clone();
    slots.forEach((d, i) => {
      const raw = t * d.speed + d.phase;
      const cycle = Math.floor(raw);
      const f = raw - cycle;
      if (cycle !== d.cycle) {
        d.cycle = cycle;
        d.from = anim.dir().multiplyScalar(START_R);
        d.to = anim.dir().multiplyScalar(START_R);
      }
      const fe = built.irons[d.heme];
      const inbound = f < 0.5;
      const k = inbound ? f / 0.5 : (f - 0.5) / 0.5;
      const e = inbound ? 1 - Math.pow(1 - k, 2) : k * k;
      if (inbound) tmp.p.copy(d.from).lerp(fe, e);
      else tmp.p.copy(fe).lerp(d.to, e);
      const sc = (inbound ? Math.min(1, k / 0.15) : Math.min(1, (1 - k) / 0.2)) * (k > 0.97 && inbound ? 0.6 : 1);
      tmp.q.setFromAxisAngle(d.spin, t * 1.5 + i);
      const atom = (mesh: THREE.InstancedMesh, slot: number, x: number, y: number, z: number) => {
        tmp.v.set(x, y, z).multiplyScalar(MOL_SCALE).applyQuaternion(tmp.q).add(tmp.p);
        tmp.m.compose(tmp.v, tmp.q, tmp.s.setScalar(sc));
        mesh.setMatrixAt(slot, tmp.m);
      };
      if (inbound) {
        // H2O2: O-O with one H on each O
        atom(oMesh, i * 2, -0.73, 0, 0);
        atom(oMesh, i * 2 + 1, 0.73, 0, 0);
        atom(hMesh, i * 2, -1.0, 0.9, 0);
        atom(hMesh, i * 2 + 1, 1.0, 0, 0.9);
      } else if (d.water) {
        // H2O
        atom(oMesh, i * 2, 0, 0, 0);
        oMesh.setMatrixAt(i * 2 + 1, hide);
        atom(hMesh, i * 2, -0.76, 0.59, 0);
        atom(hMesh, i * 2 + 1, 0.76, 0.59, 0);
      } else {
        // O2
        atom(oMesh, i * 2, -0.6, 0, 0);
        atom(oMesh, i * 2 + 1, 0.6, 0, 0);
        hMesh.setMatrixAt(i * 2, hide);
        hMesh.setMatrixAt(i * 2 + 1, hide);
      }
    });
    oMesh.instanceMatrix.needsUpdate = true;
    hMesh.instanceMatrix.needsUpdate = true;
  });

  const hotspots: HotspotDef[] = useMemo(() => {
    const p = (v: THREE.Vector3) => v.toArray() as [number, number, number];
    return [
      { id: 'subunit', position: p(built.sub) },
      { id: 'heme', position: p(built.fe) },
      { id: 'nadph', position: p(built.ndp) },
      { id: 'reaction', position: p(built.fe.clone().add(new THREE.Vector3(14, 16, 30))) },
    ];
  }, [built]);

  return (
    <group ref={ref}>
      <group ref={inner}>
        <group scale={A}>
          <primitive object={built.group} />
          <primitive object={anim.oMesh} />
          <primitive object={anim.hMesh} />
          <Hotspots level={LEVEL} items={hotspots} labels={LEVELS[LEVEL].parts} selected={props.selected} onSelect={props.onSelect} />
        </group>
      </group>
    </group>
  );
}

export function CatalaseLevel(props: { selected: string | null; onSelect: (l: number, h: HotspotDef) => void }) {
  return <CatalaseModel {...props} />;
}
