import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { normalizeIp } from './ip.js';

/**
 * Known VPN / proxy / datacenter IPv4 ranges (X4BNet lists_vpn by default), kept
 * as sorted [start, end] pairs for a binary search. Refreshed daily and cached on
 * disk, so a failed download keeps the last good list.
 */
let ranges: [number, number][] = [];
const CACHE = path.resolve('.cache/vpn-ipv4.txt');
const DAY = 24 * 60 * 60 * 1000;

function ipv4ToInt(ip: string) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function parseCidrs(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const line of text.split(/\r?\n/)) {
    const [addr, bitsRaw] = line.trim().split('/');
    if (!addr || addr.startsWith('#')) continue;
    const start = ipv4ToInt(addr);
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (start === null || !(bits >= 0 && bits <= 32)) continue;
    const size = 2 ** (32 - bits);
    const base = start - (start % size);
    out.push([base, base + size - 1]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function setVpnRanges(cidrs: string) {
  ranges = parseCidrs(cidrs);
}

export function isVpnIp(rawIp: string | undefined) {
  const n = ipv4ToInt(normalizeIp(rawIp));
  if (n === null || !ranges.length) return false;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = ranges[mid]!;
    if (n < s) hi = mid - 1;
    else if (n > e) lo = mid + 1;
    else return true;
  }
  return false;
}

async function refresh() {
  try {
    const res = await fetch(config().VPN_LIST_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    setVpnRanges(text);
    await fs.mkdir(path.dirname(CACHE), { recursive: true });
    await fs.writeFile(CACHE, text);
    console.log(`[vpn] loaded ${ranges.length} ranges`);
  } catch (e) {
    console.warn(`[vpn] could not refresh the list: ${(e as Error).message}`);
  }
}

/** Loads the cached list, refreshes it when stale, then once a day. */
export async function startVpnList() {
  if (!config().VPN_BLOCK) return;
  try {
    const stat = await fs.stat(CACHE);
    setVpnRanges(await fs.readFile(CACHE, 'utf8'));
    if (Date.now() - stat.mtimeMs > DAY) void refresh();
  } catch {
    void refresh();
  }
  setInterval(() => void refresh(), DAY).unref();
}
