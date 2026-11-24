import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, codeKey, codeProblem, devicesKey, parseHash, redis } from '@/lib/access';

// Every request to the site (pages and 3D models) must carry a valid access cookie.
// The code-entry page, the admin page and their APIs are left open.
export async function proxy(req: NextRequest) {
  const cookie = req.cookies.get(ACCESS_COOKIE)?.value || '';
  const [code, device] = cookie.split('|');

  let reason = 'none';
  if (code && device) {
    try {
      const [flat, member] = await redis<any>(['HGETALL', codeKey(code)], ['SISMEMBER', devicesKey(code), device]);
      const problem = codeProblem(parseHash(code, flat));
      if (!problem && Number(member) === 1) return NextResponse.next();
      reason = problem || 'device';
    } catch {
      reason = 'error';
    }
  }

  const isPage = req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html');
  const res = isPage
    ? NextResponse.redirect(new URL(reason === 'none' ? '/unlock' : `/unlock?r=${reason}`, req.url))
    : new NextResponse('Unauthorized', { status: 401 });
  if (cookie && reason !== 'error') res.cookies.delete(ACCESS_COOKIE);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|unlock|admin|api/unlock|api/admin).*)'],
};
