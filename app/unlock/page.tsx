'use client';
import { useEffect, useState } from 'react';
import '../access.css';

const MESSAGES: Record<string, string> = {
  invalid: 'Код буруу байна. Дахин шалгаад оруулна уу.',
  revoked: 'Энэ код хаагдсан байна. Худалдагчтай холбогдоно уу.',
  expired: 'Энэ кодын хугацаа дууссан байна.',
  deviceLimit: 'Энэ код зөвшөөрөгдсөн тооны төхөөрөмж дээр аль хэдийн ашиглагдаж байна.',
  device: 'Энэ төхөөрөмжийн эрх хүчингүй болсон. Кодоо дахин оруулна уу.',
  tooMany: 'Хэт олон удаа буруу оруулсан байна. 10 минутын дараа дахин оролдоно уу.',
  db: 'Сервертэй холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.',
  error: 'Сервертэй холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.',
};

export default function UnlockPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r');
    if (r && MESSAGES[r]) setError(MESSAGES[r]);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        window.location.href = '/';
        return;
      }
      setError(MESSAGES[data.error] || MESSAGES.invalid);
    } catch {
      setError(MESSAGES.db);
    }
    setBusy(false);
  }

  return (
    <div className="ac-wrap">
      <form className="ac-card" onSubmit={submit}>
        <h1>Элэг</h1>
        <p>Сайтыг үзэхийн тулд худалдаж авахдаа авсан кодоо оруулна уу.</p>
        <input
          className="ac-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="LIVER-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
        />
        <button className="ac-btn" disabled={busy}>{busy ? 'Шалгаж байна…' : 'Нэвтрэх'}</button>
        {error && <div className="ac-err">{error}</div>}
      </form>
    </div>
  );
}
