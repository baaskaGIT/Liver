'use client';
import { useCallback, useEffect, useState } from 'react';
import '../access.css';

type Code = { code: string; note: string; created: number; expires: number | null; max: number; revoked: boolean; devices: number };

const ERR: Record<string, string> = {
  wrong: 'Нууц үг буруу байна.',
  tooMany: 'Хэт олон удаа буруу оруулсан. 15 минутын дараа оролдоно уу.',
  noPassword: 'Vercel дээр ADMIN_PASSWORD тохируулаагүй байна.',
  db: 'Өгөгдлийн сантай холбогдож чадсангүй (Vercel дээр Upstash Redis холбогдсон эсэхийг шалгана уу).',
};

const fmt = (ms: number) => new Date(ms).toLocaleDateString('mn-MN', { year: 'numeric', month: '2-digit', day: '2-digit' });

async function api(body?: object) {
  const res = await fetch('/api/admin', body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' });
  return res.json().catch(() => ({ error: 'db' }));
}

export default function AdminPage() {
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<Code[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState('365');
  const [max, setMax] = useState('2');
  const [made, setMade] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    const data = await api();
    if (data.codes) { setCodes(data.codes); setState('ready'); setError(''); }
    else { setState('login'); if (data.error && data.error !== 'auth') setError(ERR[data.error] || ERR.db); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const data = await api({ action: 'login', password });
    if (data.ok) { setPassword(''); load(); } else setError(ERR[data.error] || ERR.db);
  }

  async function act(action: string, code?: string) {
    const data = await api({ action, code, note, days: Number(days), max: Number(max) });
    if (data.codes) setCodes(data.codes);
    if (data.error) setError(ERR[data.error] || ERR.db); else setError('');
    if (action === 'create' && data.code) { setMade(data.code); setNote(''); }
  }

  function copy(code: string) {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(''), 1500);
  }

  if (state === 'loading') return <div className="ac-wrap" />;

  if (state === 'login') {
    return (
      <div className="ac-wrap">
        <form className="ac-card" onSubmit={login}>
          <h1>Админ</h1>
          <p>Кодуудыг удирдахын тулд админ нууц үгээ оруулна уу.</p>
          <input className="ac-input plain" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Нууц үг" autoFocus />
          <button className="ac-btn">Нэвтрэх</button>
          {error && <div className="ac-err">{error}</div>}
        </form>
      </div>
    );
  }

  const now = Date.now();
  return (
    <div className="ad-wrap">
      <div className="ad-head">
        <h1>Кодууд</h1>
        <button className="ad-link" onClick={async () => { await api({ action: 'logout' }); setState('login'); }}>Гарах</button>
      </div>

      <div className="ad-box">
        <h2>Шинэ код үүсгэх</h2>
        <form className="ad-form" onSubmit={(e) => { e.preventDefault(); act('create'); }}>
          <label>Худалдан авагч (нэр, утас г.м.)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Жишээ: Бат, 9911xxxx" />
          </label>
          <label>Хугацаа
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="30">1 сар</option>
              <option value="90">3 сар</option>
              <option value="180">6 сар</option>
              <option value="365">1 жил</option>
              <option value="0">Хугацаагүй</option>
            </select>
          </label>
          <label>Төхөөрөмж
            <select value={max} onChange={(e) => setMax(e.target.value)}>
              <option value="1">1 төхөөрөмж</option>
              <option value="2">2 төхөөрөмж</option>
            </select>
          </label>
          <button className="ac-btn">Үүсгэх</button>
        </form>
        {made && (
          <div className="ad-new">Шинэ код:<b>{made}</b>
            <span className="ad-acts" style={{ display: 'inline-flex' }}><button onClick={() => copy(made)}>{copied === made ? 'Хуулсан ✓' : 'Хуулах'}</button></span>
          </div>
        )}
        {error && <div className="ac-err">{error}</div>}
      </div>

      <div className="ad-box">
        <h2>Бүх код ({codes.length})</h2>
        {codes.length === 0 ? <div className="ad-empty">Одоогоор код алга.</div> : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Код</th><th>Худалдан авагч</th><th>Үүсгэсэн</th><th>Дуусах</th><th>Төхөөрөмж</th><th>Төлөв</th><th></th></tr></thead>
              <tbody>
                {codes.map((c) => {
                  const expired = c.expires !== null && now > c.expires;
                  const active = !c.revoked && !expired;
                  return (
                    <tr key={c.code}>
                      <td className="ad-code">{c.code}</td>
                      <td>{c.note || '—'}</td>
                      <td>{fmt(c.created)}</td>
                      <td>{c.expires ? fmt(c.expires) : 'Хугацаагүй'}</td>
                      <td>{c.devices} / {c.max}</td>
                      <td><span className={`ad-st ${active ? 'on' : 'off'}`}>{c.revoked ? 'Хаагдсан' : expired ? 'Хугацаа дууссан' : 'Идэвхтэй'}</span></td>
                      <td>
                        <div className="ad-acts">
                          <button onClick={() => copy(c.code)}>{copied === c.code ? 'Хуулсан ✓' : 'Хуулах'}</button>
                          {c.revoked
                            ? <button onClick={() => act('restore', c.code)}>Нээх</button>
                            : <button className="danger" onClick={() => act('revoke', c.code)}>Хаах</button>}
                          <button onClick={() => act('resetDevices', c.code)} title="Бүртгэлтэй төхөөрөмжүүдийг цэвэрлэнэ">Төхөөрөмж цэвэрлэх</button>
                          <button className="danger" onClick={() => { if (confirm(`${c.code} кодыг бүр мөсөн устгах уу?`)) act('delete', c.code); }}>Устгах</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
