import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import { screen } from '../lib/profanity.js';
import { ReportService } from '../services/ReportService.js';

type Target = Parameters<typeof ReportService.flag>[0];

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

/**
 * Screens the listed body fields (after `validate`).
 * - severe → 422 `profanity_blocked`: never saved.
 * - mild → 422 `profanity_warning` until the author resends with `acknowledgeProfanity`;
 *   then it is saved and auto-reported for a reviewer, using the id in the response.
 */
export const screenText =
  (
    target: Target,
    fields: string[],
    idOf: (data: Record<string, unknown>) => unknown = (d) => d.id,
  ): RequestHandler =>
  (req, res, next) => {
    const body = (req.data.body ?? {}) as Record<string, unknown>;
    const result = screen(...fields.flatMap((f) => strings(body[f])));
    if (result.level === 'severe')
      throw new AppError(
        422,
        'profanity_blocked',
        'This can’t be sent because it contains offensive language',
        {
          words: result.words,
        },
      );
    if (result.level === 'mild') {
      if (!body.acknowledgeProfanity)
        throw new AppError(
          422,
          'profanity_warning',
          'This contains language that may be offensive',
          {
            words: result.words,
          },
        );
      const json = res.json.bind(res);
      res.json = (data: unknown) => {
        const found =
          data && typeof data === 'object' ? idOf(data as Record<string, unknown>) : null;
        // Bulk endpoints return several ids; each saved item gets its own report.
        const ids = [found].flat().filter(Boolean);
        if (!ids.length || res.statusCode >= 300) return json(data);
        // Send once the reports exist, so reviewers (and tests) see them immediately.
        void Promise.all(ids.map((id) => ReportService.flag(target, String(id), result.words)))
          .catch((e) => console.error('[profanity] flag failed', e))
          .finally(() => json(data));
        return res;
      };
    }
    next();
  };
