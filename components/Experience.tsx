'use client';
import { useProgress } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LEVELS, LIVER_STATES, MONGOLIA_NOTE, type LiverState } from '@/content/levels';
import { journey, LEVEL_COUNT, smoothstep } from '@/lib/journey';
import { Scene } from './three/Scene';
import type { HotspotDef } from './three/Hotspots';

const SECTION_VH = 1.6; // each level gets 160vh of scrolling

function Loader() {
  const { active, progress } = useProgress();
  const [gone, setGone] = useState(false);
  const done = !active && progress >= 100;
  useEffect(() => {
    if (done) {
      const id = setTimeout(() => setGone(true), 700);
      return () => clearTimeout(id);
    }
  }, [done]);
  if (gone) return null;
  return (
    <div className={`loader${done ? ' done' : ''}`}>
      <div className="loader-ring" />
      <p>3D загваруудыг ачаалж байна… {Math.round(progress)}%</p>
    </div>
  );
}

export default function Experience() {
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<{ level: number; id: string } | null>(null);
  const [liverState, setLiverState] = useState<LiverState>('healthy');
  const activeRef = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const sectionH = window.innerHeight * SECTION_VH;
      const u = window.scrollY / sectionH;
      const i = Math.floor(u);
      const frac = u - i;
      const t = i < LEVEL_COUNT - 1 ? i + smoothstep(0.35, 1, frac) : LEVEL_COUNT - 1;
      journey.target = Math.min(Math.max(t, 0), LEVEL_COUNT - 1);
      const a = Math.round(journey.target);
      if (a !== activeRef.current) {
        activeRef.current = a;
        setActive(a);
        setSelected(null);
      }
    };
    // touch: dragging sideways turns the model (up/down still scrolls the page); mouse: the model follows the cursor
    const drag = { x: 0, start: 0 };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      drag.x = e.clientX;
      drag.start = journey.pointer.x;
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        const x = drag.start + ((e.clientX - drag.x) / window.innerWidth) * 2;
        journey.pointer.x = Math.min(1, Math.max(-1, x));
        return;
      }
      journey.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const goTo = useCallback((level: number) => {
    const sectionH = window.innerHeight * SECTION_VH;
    window.scrollTo({ top: level * sectionH + (level > 0 ? 0.02 * sectionH : 0), behavior: 'smooth' });
  }, []);

  const onSelect = useCallback(
    (level: number, h: HotspotDef) => {
      if (h.enter && level < LEVEL_COUNT - 1) goTo(level + 1);
      else setSelected((s) => (s?.level === level && s.id === h.id ? null : { level, id: h.id }));
    },
    [goTo],
  );

  const chooseState = (s: LiverState) => {
    setLiverState(s);
    journey.liverState = s;
  };

  return (
    <>
      <div className="canvas-wrap">
        <Canvas camera={{ position: [0, 0, 5], fov: 35, near: 0.02, far: 80 }} dpr={[1, 2]} gl={{ antialias: false, powerPreference: 'high-performance' }}>
          <Scene selected={selected} onSelect={onSelect} />
        </Canvas>
      </div>
      <Loader />

      <header className="topbar">
        <button className="brand" onClick={() => goTo(0)}>
          <span className="brand-mark" />
          Элэг
        </button>
      </header>

      <nav className="levels" aria-label="Түвшнүүд">
        {LEVELS.map((L, i) => (
          <button key={L.id} className={`lv${active === i ? ' on' : ''}${active > i ? ' past' : ''}`} onClick={() => goTo(i)}>
            <span className="lv-name">{L.en}</span>
            <span className="lv-dot" />
          </button>
        ))}
      </nav>

      <main>
        {LEVELS.map((L, i) => {
          const part = selected?.level === i ? L.parts[selected.id] : null;
          return (
            <section className="stage" key={L.id} style={{ height: `${SECTION_VH * 100}vh` }}>
              <article className={`card${active === i ? ' show' : ''}`}>
                {i === 0 && (
                  <div className="hero">
                    <h1>Элэг</h1>
                    <p className="hero-sub">Хүний биеэс молекул хүртэлх аялал</p>
                  </div>
                )}
                <div className="kicker">
                  <span>{L.kicker}</span>
                  <span className="chip">{L.scale}</span>
                </div>
                <h2>
                  {L.title} <span className="en">{L.en}</span>
                </h2>
                <p className="lead">{L.text}</p>

                {L.id === 'liver' && (
                  <div className="states">
                    <div className="seg" role="tablist">
                      {(Object.keys(LIVER_STATES) as LiverState[]).map((s) => (
                        <button key={s} role="tab" aria-selected={liverState === s} className={`seg-btn ${s}${liverState === s ? ' on' : ''}`} onClick={() => chooseState(s)}>
                          {LIVER_STATES[s].label}
                        </button>
                      ))}
                    </div>
                    <div className={`state-info ${liverState}`}>
                      <strong>
                        {LIVER_STATES[liverState].title}
                        {'en' in LIVER_STATES[liverState] && <span className="en"> {(LIVER_STATES[liverState] as any).en}</span>}
                      </strong>
                      <p>{LIVER_STATES[liverState].text}</p>
                    </div>
                    {liverState !== 'healthy' && <p className="note">{MONGOLIA_NOTE}</p>}
                  </div>
                )}

                {part ? (
                  <div className="part">
                    <button className="part-close" onClick={() => setSelected(null)} aria-label="Хаах">
                      ×
                    </button>
                    <strong>{part.name}</strong>
                    {part.en && <span className="en"> {part.en}</span>}
                    <p>{part.text}</p>
                  </div>
                ) : (
                  <ul className="facts">
                    {L.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </article>
            </section>
          );
        })}

        <section className="outro">
          <div className="outro-inner">
            <h2>Биеэс молекул хүртэл</h2>
            <p className="lead">Хүний биеэс эхлээд элэг, дэлбэнцэр, элэгний эс, пероксисом, каталаза молекул хүртэл 6 түвшинд 50 сая орчим дахин томруулж харлаа.</p>
            <ol className="recap">
              {LEVELS.map((L, i) => (
                <li key={L.id}>
                  <button onClick={() => goTo(i)}>
                    <span className="recap-scale">{L.scale}</span>
                    {L.title}
                  </button>
                </li>
              ))}
            </ol>
            <button className="cta" onClick={() => goTo(0)}>
              ↑ Эхнээс нь
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
