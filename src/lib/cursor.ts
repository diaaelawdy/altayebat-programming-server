import { Types } from 'mongoose';
import { BadRequest } from '../errors/AppError.js';

export interface CursorValue {
  v: string | number | null; // sort-field value (dates as ISO strings)
  id: string;
}

export const encodeCursor = (c: CursorValue) =>
  Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw?: string): CursorValue | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as CursorValue;
    if (!Types.ObjectId.isValid(c.id)) throw new Error();
    return c;
  } catch {
    throw new BadRequest('Invalid cursor');
  }
}

/**
 * Keyset filter for a descending sort on `field`, tie-broken by _id descending.
 * Pass `isDate` so the cursor value is revived as a Date.
 */
export function afterCursor(field: string, cursor: CursorValue | null, isDate = false) {
  if (!cursor) return {};
  const id = new Types.ObjectId(cursor.id);
  if (field === '_id') return { _id: { $lt: id } };
  const v = isDate && cursor.v !== null ? new Date(cursor.v) : cursor.v;
  return { $or: [{ [field]: { $lt: v } }, { [field]: v, _id: { $lt: id } }] };
}

export function pageOf<T extends { _id: Types.ObjectId }>(
  rows: T[],
  limit: number,
  field: string,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  if (!hasMore || !last) return { items, nextCursor: null };
  const raw = field === '_id' ? null : (last as Record<string, unknown>)[field];
  const v = raw instanceof Date ? raw.toISOString() : ((raw as string | number | null) ?? null);
  return { items, nextCursor: encodeCursor({ v, id: String(last._id) }) };
}

/**
 * Offset cursors, for lists whose sort has no cheap keyset (multi-field sorts,
 * small admin queues). Opaque to clients, same `{ items, nextCursor }` shape.
 */
export const DEFAULT_PAGE = 20;
export interface PageQuery {
  cursor?: string;
  limit: number;
}

export function offsetOf(raw?: string) {
  if (!raw) return 0;
  const n = Number(Buffer.from(raw, 'base64url').toString().replace(/^o:/, ''));
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new BadRequest('Invalid cursor');
  return n;
}

/** `rows` must be fetched with `.skip(offset).limit(limit + 1)`. */
export function offsetPage<T>(rows: T[], limit: number, offset: number) {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore
      ? Buffer.from(`o:${offset + limit}`).toString('base64url')
      : (null as string | null),
  };
}

/** Skip/limit for a page query (fetches one extra row to know if there's more). */
export const pageWindow = (p: PageQuery) => ({ skip: offsetOf(p.cursor), take: p.limit + 1 });
