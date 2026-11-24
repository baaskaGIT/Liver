import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE, INDEX_KEY, codeKey, dbConfigured, devicesKey, normalizeCode, parseHash, randomCode, redis,
} from '@/lib/access';

export const dynamic = 'force-dynamic';

const PASSWORD = process.env.ADMIN_PASSWORD || '';
const token = () => createHash('sha256').update(`${PASSWORD}:liver-admin`).digest('hex');

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const isAdmin = (req: NextRequest) => Boolean(PASSWORD) && same(req.cookies.get(ADMIN_COOKIE)?.value || '', token());
const json = (data: object, status = 200) => NextResponse.json(data, { status });

async function listCodes() {
  const [codes] = await redis<string[]>(['SMEMBERS', INDEX_KEY]);
  if (!codes?.length) return [];
  const out = await redis<any>(...codes.flatMap((c) => [['HGETALL', codeKey(c)], ['SCARD', devicesKey(c)]]));
  return codes
    .map((c, i) => parseHash(c, out[i * 2], Number(out[i * 2 + 1])))
    .filter(Boolean)
    .sort((a, b) => b!.created - a!.created);
}

export async function GET(req: NextRequest) {
  if (!PASSWORD) return json({ error: 'noPassword' }, 500);
  if (!dbConfigured()) return json({ error: 'db' }, 500);
  if (!isAdmin(req)) return json({ error: 'auth' }, 401);
  try {
    return json({ codes: await listCodes() });
  } catch {
    return json({ error: 'db' }, 500);
  }
}

export async function POST(req: NextRequest) {
  if (!PASSWORD) return json({ error: 'noPassword' }, 500);
  if (!dbConfigured()) return json({ error: 'db' }, 500);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  try {
    if (action === 'login') {
      const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
      const rl = `rl:admin:${ip}`;
      const [tries] = await redis<number>(['GET', rl]);
      if (Number(tries) >= 10) return json({ error: 'tooMany' }, 429);
      if (!same(String(body.password || ''), PASSWORD)) {
        await redis(['INCR', rl], ['EXPIRE', rl, 900]);
        return json({ error: 'wrong' }, 401);
      }
      const res = json({ ok: true });
      res.cookies.set(ADMIN_COOKIE, token(), {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }

    if (action === 'logout') {
      const res = json({ ok: true });
      res.cookies.delete(ADMIN_COOKIE);
      return res;
    }

    if (!isAdmin(req)) return json({ error: 'auth' }, 401);

    if (action === 'create') {
      const note = String(body.note || '').slice(0, 120);
      const max = Math.min(5, Math.max(1, Number(body.max) || 2));
      const days = Number(body.days) || 0; // 0 = no expiry
      let code = '';
      for (let i = 0; i < 20 && !code; i++) {
        const c = randomCode();
        const [exists] = await redis<number>(['EXISTS', codeKey(c)]);
        if (!Number(exists)) code = c;
      }
      if (!code) return json({ error: 'gen' }, 500);
      const now = Date.now();
      await redis(
        ['HSET', codeKey(code), 'note', note, 'created', now, 'expires', days > 0 ? now + days * 86400000 : '', 'max', max, 'revoked', '0'],
        ['SADD', INDEX_KEY, code],
      );
      return json({ ok: true, code, codes: await listCodes() });
    }

    const code = normalizeCode(String(body.code || ''));
    const [exists] = await redis<number>(['EXISTS', codeKey(code)]);
    if (!Number(exists)) return json({ error: 'notFound' }, 404);

    if (action === 'revoke') await redis(['HSET', codeKey(code), 'revoked', '1']);
    else if (action === 'restore') await redis(['HSET', codeKey(code), 'revoked', '0']);
    else if (action === 'resetDevices') await redis(['DEL', devicesKey(code)]);
    else if (action === 'delete') await redis(['DEL', codeKey(code), devicesKey(code)], ['SREM', INDEX_KEY, code]);
    else return json({ error: 'action' }, 400);

    return json({ ok: true, codes: await listCodes() });
  } catch {
    return json({ error: 'db' }, 500);
  }
}
