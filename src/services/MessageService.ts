import type { Types } from 'mongoose';
import { MessageRepository, UserRepository } from '../repositories/index.js';
import { authorOf, type PublicUserRef } from '../serializers/index.js';
import { AppError, BadRequest, Forbidden, NotFound } from '../errors/AppError.js';
import { NotificationService } from './NotificationService.js';
import type { Permission } from '../shared/permissions.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';

type Id = Types.ObjectId;
type ConversationDoc = NonNullable<Awaited<ReturnType<typeof MessageRepository.findConversation>>>;
type MessageDoc = Awaited<ReturnType<typeof MessageRepository.messages>>[number];
interface Viewer {
  _id: Id;
  perms: Set<Permission>;
}

/** Messages sent on behalf of the team show as the site itself to the other side. */
const TEAM = { system: true as const };

const isTeam = (v: Viewer) => v.perms.has('messages.team_inbox');
const same = (a: unknown, b: unknown) => a != null && String(a) === String(b);

function canView(c: ConversationDoc, v: Viewer) {
  return same(c.starterId, v._id) || same(c.recipientId, v._id) || (c.kind === 'team' && isTeam(v));
}

/** Team members see who on the team wrote it; everyone else sees only "the team". */
function teamSide(c: ConversationDoc, v: Viewer) {
  return c.kind === 'team' && isTeam(v) && !same(c.starterId, v._id);
}

/** A restricted account with messaging off hears only from the team. */
async function assertCanReceive(userId: Id | null | undefined, v: Viewer) {
  if (!userId || isTeam(v)) return;
  const u = await UserRepository.findAuthById(userId);
  if (u && u.status !== 'active' && u.ban?.canMessage === false)
    throw new AppError(403, 'recipient_messages_off', 'This user cannot receive messages');
}

function unread(c: ConversationDoc, v: Viewer) {
  if (same(c.lastAuthorId, v._id)) return false;
  const r = c.reads?.find((x) => same(x.userId, v._id));
  return !r?.at || +r.at < +c.lastMessageAt;
}

function messageDto(
  m: MessageDoc,
  c: ConversationDoc,
  v: Viewer,
  refs: Map<string, PublicUserRef>,
) {
  const mine = same(m.authorId, v._id);
  const staffView = teamSide(c, v) || (isTeam(v) && mine);
  const hidden = m.asTeam && !mine && !staffView;
  return {
    id: String(m._id),
    body: m.body,
    createdAt: m.createdAt,
    mine,
    asTeam: m.asTeam,
    author: hidden ? TEAM : authorOf(refs, m.authorId),
  };
}

async function summaries(list: ConversationDoc[], v: Viewer) {
  const refs = await UserRepository.publicRefs(
    list.flatMap((c) => [c.starterId, c.recipientId, c.answeredBy].filter((x) => x != null)),
  );
  return list.map((c) => {
    const staff = teamSide(c, v);
    const other =
      c.kind === 'team'
        ? staff
          ? authorOf(refs, c.starterId)
          : TEAM
        : authorOf(refs, same(c.starterId, v._id) ? c.recipientId : c.starterId);
    return {
      id: String(c._id),
      kind: c.kind,
      subject: c.subject,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      unread: unread(c, v),
      with: other,
      // Only the team sees which team member answered.
      answeredBy: staff && c.answeredBy ? authorOf(refs, c.answeredBy) : null,
    };
  });
}

export const MessageService = {
  async list(v: Viewer, box: 'mine' | 'team', page: PageQuery) {
    if (box === 'team' && !isTeam(v)) throw new Forbidden();
    const w = pageWindow(page);
    const rows =
      box === 'team' ? await MessageRepository.team(w) : await MessageRepository.mine(v._id, w);
    const { items, nextCursor } = offsetPage(rows, page.limit, w.skip);
    return { items: await summaries(items, v), nextCursor };
  },

  async get(v: Viewer, id: string) {
    const c = await MessageRepository.findConversation(id).catch(() => null);
    if (!c || !canView(c, v)) throw new NotFound();
    const msgs = await MessageRepository.messages(c._id);
    const refs = await UserRepository.publicRefs(msgs.map((m) => m.authorId));
    await MessageRepository.markRead(c._id, v._id);
    const [summary] = await summaries([c], v);
    return {
      ...summary!,
      unread: false,
      canReplyAsTeam: isTeam(v),
      messages: msgs.map((m) => messageDto(m, c, v, refs)),
    };
  },

  /** Starts a conversation: to the team by default, or to one user with `messages.send_any`. */
  async start(v: Viewer, input: { subject: string; body: string; to?: string; asTeam?: boolean }) {
    let recipientId: Id | null = null;
    if (input.to) {
      if (!v.perms.has('messages.send_any')) throw new Forbidden();
      const r = await UserRepository.findByUsername(input.to);
      if (!r) throw new NotFound('User not found');
      if (same(r._id, v._id)) throw new BadRequest('You cannot message yourself');
      await assertCanReceive(r._id, v);
      recipientId = r._id;
    }
    const c = await MessageRepository.createConversation({
      kind: recipientId ? 'direct' : 'team',
      subject: input.subject,
      starterId: v._id,
      recipientId,
    });
    const m = await MessageRepository.addMessage({
      conversationId: c._id,
      authorId: v._id,
      body: input.body,
      asTeam: Boolean(recipientId && input.asTeam && isTeam(v)),
    });
    if (recipientId)
      await NotificationService.notify(recipientId, 'message.new', {
        conversationId: String(c._id),
        subject: input.subject,
      });
    return { id: String(c._id), messageId: String(m._id) };
  },

  async reply(v: Viewer, id: string, input: { body: string; asTeam?: boolean }) {
    const c = await MessageRepository.findConversation(id).catch(() => null);
    if (!c || !canView(c, v)) throw new NotFound();
    const fromTeam = teamSide(c, v);
    if (c.kind === 'direct')
      await assertCanReceive(same(c.starterId, v._id) ? c.recipientId : c.starterId, v);
    // Team replies go out as the team unless the author picks their own name;
    // in direct conversations only when they explicitly choose it.
    const asTeam =
      isTeam(v) &&
      (fromTeam ? input.asTeam !== false : c.kind === 'direct' && input.asTeam === true);
    const m = await MessageRepository.addMessage({
      conversationId: c._id,
      authorId: v._id,
      body: input.body,
      asTeam,
    });
    await MessageRepository.touch(c._id, {
      lastMessageAt: m.createdAt,
      lastAuthorId: v._id,
      ...(c.kind === 'team'
        ? fromTeam
          ? { status: 'answered', answeredBy: v._id }
          : { status: 'open' }
        : {}),
    });
    await MessageRepository.markRead(c._id, v._id);
    // Tell the other side. Team conversations notify the starter when the team replies.
    const notifyId =
      c.kind === 'team'
        ? fromTeam
          ? c.starterId
          : null
        : same(c.starterId, v._id)
          ? c.recipientId
          : c.starterId;
    if (notifyId)
      await NotificationService.notify(notifyId, 'message.reply', {
        conversationId: String(c._id),
        subject: c.subject,
      });
    return { id: String(c._id), messageId: String(m._id) };
  },

  async unreadCount(v: Viewer) {
    const [mine, team] = await Promise.all([
      MessageRepository.mine(v._id),
      isTeam(v) ? MessageRepository.team() : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    let n = 0;
    for (const c of [...mine, ...team]) {
      const key = String(c._id);
      if (seen.has(key)) continue;
      seen.add(key);
      if (unread(c, v)) n++;
    }
    return n;
  },

  /** For reports about a message: its text, author and conversation. */
  async loadForReport(messageId: string) {
    const m = await MessageRepository.findMessage(messageId).catch(() => null);
    return m
      ? { authorId: m.authorId, body: m.body, conversationId: String(m.conversationId) }
      : null;
  },
};
