import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import {
  CompanyRepository,
  QuestionRepository,
  RoleRepository,
  UserRepository,
} from '../repositories/index.js';
import { audit } from '../services/audit.js';

type Target = 'question' | 'company' | 'user' | 'role';

/** A readable name and link for the target, captured before the action runs. */
async function describe(type: Target, id: string): Promise<{ label: string; link: string }> {
  if (!Types.ObjectId.isValid(id)) return { label: '', link: '' };
  if (type === 'question') {
    const q = await QuestionRepository.findById(id);
    const c = q && (await CompanyRepository.findById(q.companyId));
    return { label: q?.title ?? '', link: q && c ? `/c/${c.slug}/${q.slug}` : '' };
  }
  if (type === 'company') {
    const c = await CompanyRepository.findById(id);
    return { label: c?.name ?? '', link: c ? `/c/${c.slug}` : '' };
  }
  if (type === 'user') {
    const u = await UserRepository.findById(id);
    return { label: u?.username ? `@${u.username}` : '', link: u ? `/u/${u.username}` : '' };
  }
  const r = await RoleRepository.findById(id);
  return { label: r?.name ?? '', link: '/admin/roles' };
}

/**
 * Logs a successful request to the activity log (history only, not undoable).
 * The target is `:id`, or the `id` of the created item in the response.
 */
export const logged =
  (
    action: string,
    type: Target,
    detail?: (req: Request) => string | Promise<string>,
  ): RequestHandler =>
  async (req, res, next) => {
    const paramId = req.params.id ? String(req.params.id) : '';
    const before = paramId ? await describe(type, paramId).catch(() => null) : null;
    let sent: unknown;
    const json = res.json.bind(res);
    res.json = (b: unknown) => {
      sent = b;
      return json(b);
    };
    const end = res.end.bind(res) as (...a: unknown[]) => typeof res;
    res.end = ((...args: unknown[]) => {
      if (res.statusCode >= 300 || !req.user) return end(...args);
      const createdId = (sent as { id?: unknown } | undefined)?.id;
      const id = paramId || (typeof createdId === 'string' ? createdId : '');
      void (async () => {
        const info = before ?? (id ? await describe(type, id).catch(() => null) : null);
        await audit.record(req.user!._id, {
          action,
          targetType: type,
          targetId: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null,
          label:
            info?.label ||
            String(
              (req.body as { name?: string; title?: string })?.name ??
                (req.body as { title?: string })?.title ??
                '',
            ),
          link: info?.link ?? '',
          detail: detail ? await detail(req) : '',
        });
      })().finally(() => end(...args));
      return res;
    }) as typeof res.end;
    next();
  };

export const bodyField = (k: string) => (req: Request) =>
  String((req.body as Record<string, unknown>)?.[k] ?? '');
