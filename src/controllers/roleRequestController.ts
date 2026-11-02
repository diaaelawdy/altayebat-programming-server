import type { Request, Response } from 'express';
import { body, query } from '../middleware/index.js';
import { RoleRequestService } from '../services/RoleRequestService.js';
import { pageQuery, rejectRoleRequestSchema, roleRequestSchema } from '../shared/schemas.js';

const p = (req: Request, k: string) => String(req.params[k]);

export const roleRequestController = {
  requestable: async (_req: Request, res: Response) =>
    res.json({ items: await RoleRequestService.requestable() }),
  mine: async (req: Request, res: Response) =>
    res.json(await RoleRequestService.mine(req.user!._id)),
  async create(req: Request, res: Response) {
    const { roleId, reason } = body(req, roleRequestSchema);
    await RoleRequestService.create(req.user!._id, roleId, reason);
    res.status(201).json({ ok: true });
  },
  pending: async (req: Request, res: Response) =>
    res.json(await RoleRequestService.pending(query(req, pageQuery))),
  async approve(req: Request, res: Response) {
    await RoleRequestService.approve(req.user!, p(req, 'id'));
    res.json({ ok: true });
  },
  async reject(req: Request, res: Response) {
    await RoleRequestService.reject(
      req.user!,
      p(req, 'id'),
      body(req, rejectRoleRequestSchema).note,
    );
    res.json({ ok: true });
  },
};
