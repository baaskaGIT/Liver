import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE, DEVICE_COOKIE, codeKey, codeProblem, dbConfigured, devicesKey, normalizeCode, parseHash, redis,
} from '@/lib/access';

export const dynamic = 'force-dynamic';

const MAX_TRIES = 10; // wrong guesses allowed per IP ...
const WINDOW_S = 600; // ... per 10 minutes

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  if (!dbConfigured()) return fail('db', 500);
  const body = await req.json().catch(() => ({}));
  const code = normalizeCode(String(body.code || ''));
  if (!/^LIVER-[A-Z0-9]{4,8}$/.test(code)) return fail('invalid');

  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const rlKey = `rl:unlock:${ip}`;

  try {
    const [tries] = await redis<number>(['GET', rlKey]);
    if (Number(tries) >= MAX_TRIES) return fail('tooMany', 429);

    const [flat, count] = await redis<any>(['HGETALL', codeKey(code)], ['SCARD', devicesKey(code)]);
    const rec = parseHash(code, flat, Number(count));
    const problem = codeProblem(rec);
    if (problem) {
      if (problem === 'invalid') await redis(['INCR', rlKey], ['EXPIRE', rlKey, WINDOW_S]);
      return fail(problem);
    }

    // One id per browser, kept even when the code changes, so re-entering a code on the
    // same device does not use up another device slot.
    let device = req.cookies.get(DEVICE_COOKIE)?.value || '';
    if (!/^[a-f0-9-]{36}$/.test(device)) device = crypto.randomUUID();

    const [already] = await redis<number>(['SISMEMBER', devicesKey(code), device]);
    if (Number(already) !== 1) {
      if (rec!.devices >= rec!.max) return fail('deviceLimit');
      await redis(['SADD', devicesKey(code), device]);
    }

    const res = NextResponse.json({ ok: true });
    const secure = process.env.NODE_ENV === 'production';
    const year = 60 * 60 * 24 * 365;
    const maxAge = rec!.expires ? Math.max(60, Math.floor((rec!.expires - Date.now()) / 1000)) : year;
    res.cookies.set(DEVICE_COOKIE, device, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: year * 5 });
    res.cookies.set(ACCESS_COOKIE, `${code}|${device}`, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: Math.min(maxAge, year) });
    return res;
  } catch {
    return fail('db', 500);
  }
}
