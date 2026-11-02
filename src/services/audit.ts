import type { Types } from 'mongoose';
import { AuditRepository, type AuditEntry } from '../repositories/index.js';

/** Appends to the activity log. Never fails the action it describes. */
export const audit = {
  async record(actorId: Types.ObjectId, entry: AuditEntry, opts: { undoable?: boolean } = {}) {
    try {
      if (opts.undoable) await AuditRepository.clearRedo(actorId);
      await AuditRepository.create(actorId, { ...entry, undo: opts.undoable ? 'done' : null });
    } catch (e) {
      console.error('[audit] failed to record', entry.action, e);
    }
  },
};

export const excerpt = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
