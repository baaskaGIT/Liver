// Access codes stored in Upstash Redis (Vercel Marketplace integration).
// Talks to the Redis REST API with plain fetch, so no extra npm package is needed.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const ACCESS_COOKIE = 'liver_access';
export const DEVICE_COOKIE = 'liver_device';
export const ADMIN_COOKIE = 'liver_admin';

export function dbConfigured() {
  return Boolean(URL_ && TOKEN);
}

type Cmd = (string | number)[];

export async function redis<T = unknown>(...cmds: Cmd[]): Promise<T[]> {
  if (!dbConfigured()) throw new Error('DB_NOT_CONFIGURED');
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`DB_ERROR_${res.status}`);
  const out = (await res.json()) as { result?: T; error?: string }[];
  return out.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result as T;
  });
}

export type CodeRecord = {
  code: string;
  note: string;
  created: number;
  expires: number | null; // ms timestamp, null = never
  max: number; // max devices
  revoked: boolean;
  devices: number;
};

export const codeKey = (code: string) => `code:${code}`;
export const devicesKey = (code: string) => `code:${code}:devices`;
export const INDEX_KEY = 'codes';

export function parseHash(code: string, flat: string[] | null, devices = 0): CodeRecord | null {
  if (!flat || flat.length === 0) return null;
  const h: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) h[flat[i]] = flat[i + 1];
  return {
    code,
    note: h.note || '',
    created: Number(h.created) || 0,
    expires: h.expires ? Number(h.expires) : null,
    max: Number(h.max) || 2,
    revoked: h.revoked === '1',
    devices,
  };
}

/** Upper-cases, strips spaces, and adds the LIVER- prefix if the buyer left it out. */
export function normalizeCode(input: string) {
  let c = (input || '').toUpperCase().replace(/\s+/g, '');
  if (c && !c.startsWith('LIVER-')) c = 'LIVER-' + c.replace(/^LIVER/, '');
  return c;
}

// No 0/O, 1/I/L so codes are easy to read aloud and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return 'LIVER-' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Why a code cannot be used right now, or null if it is fine. */
export function codeProblem(rec: CodeRecord | null): 'invalid' | 'revoked' | 'expired' | null {
  if (!rec) return 'invalid';
  if (rec.revoked) return 'revoked';
  if (rec.expires && Date.now() > rec.expires) return 'expired';
  return null;
}
