import type { Types } from 'mongoose';

type Id = Types.ObjectId;

/** Domain events and their payloads. */
export interface DomainEvents {
  'question.submitted': { questionId: Id; authorId: Id };
  'question.approved': { questionId: Id; companyId: Id; authorId: Id | null; reviewerId: Id };
  'question.rejected': { questionId: Id; authorId: Id | null; reason: string };
  'company.submitted': { companyId: Id | string; authorId: Id };
  'company.approved': { companyId: Id; authorId: Id | null };
  'company.rejected': { companyId: Id; authorId: Id | null; reason: string };
  'question.deleted': { questionId: Id; companyId: Id; wasApproved: boolean };
  'question.asked': { questionId: Id; companyId: Id; userId: Id };
  'answer.created': {
    answerId: Id;
    questionId: Id;
    parentId: Id | null;
    authorId: Id;
  };
  'answer.deleted': { answerId: Id; questionId: Id; parentId: Id | null; authorId: Id };
  'comment.created': { commentId: Id; companyId: Id; parentId: Id | null; authorId: Id };
  'comment.deleted': { commentId: Id; companyId: Id; parentId: Id | null };
  // Undo of a delete: counters come back, nobody is notified again.
  'answer.restored': { answerId: Id; questionId: Id; parentId: Id | null; authorId: Id };
  'comment.restored': { commentId: Id; companyId: Id; parentId: Id | null };
  'vote.cast': {
    targetType: 'answer' | 'comment' | 'review';
    targetId: Id;
    targetAuthorId: Id;
    voterId: Id;
    previous: 0 | 1 | -1;
    value: 0 | 1 | -1;
    newScore: number;
  };
  'review.changed': { companyId: Id; authorId: Id; created: boolean };
  'study.marked': { userId: Id; questionId: Id; companyId: Id };
  'user.active': { userId: Id };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;

/**
 * In-process observer. `emit` awaits all handlers so counters are consistent
 * by the time a request returns (and tests stay deterministic). Handler errors
 * are logged, never propagated to the emitting service.
 */
class EventBus {
  private handlers = new Map<keyof DomainEvents, Handler<never>[]>();

  on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(event, list);
  }

  async emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): Promise<void> {
    const list = (this.handlers.get(event) ?? []) as Handler<K>[];
    const results = await Promise.allSettled(list.map((h) => h(payload)));
    for (const r of results) {
      if (r.status === 'rejected') console.error(`[events] ${event} handler failed:`, r.reason);
    }
  }
}

export const events = new EventBus();
