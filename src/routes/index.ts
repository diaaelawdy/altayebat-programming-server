import { Router } from 'express';
import {
  noStore,
  authLimiter,
  messageLimiter,
  requireAnyPermission,
  requireAuth,
  requirePermission,
  validate,
} from '../middleware/index.js';
import * as s from '../shared/schemas.js';
import { authController as auth } from '../controllers/authController.js';
import { companyController as companies } from '../controllers/companyController.js';
import { questionController as questions, searchQuery } from '../controllers/questionController.js';
import { postController as posts } from '../controllers/postController.js';
import { messageController as messages } from '../controllers/messageController.js';
import { historyController as history } from '../controllers/historyController.js';
import { screenText } from '../middleware/profanity.js';
import { bodyField, logged } from '../middleware/audit.js';
import { RoleRepository } from '../repositories/index.js';
import { avatarBody, userController as users } from '../controllers/userController.js';
import { roleRequestController as roleRequests } from '../controllers/roleRequestController.js';

/**
 * Pipeline per route: (global: rateLimit → authenticate → csrf) → requirePermission → validate → controller.
 */
export function apiRouter() {
  const r = Router();

  // ---- auth & self ----
  r.get('/auth/csrf', auth.csrf);
  r.post('/auth/login', authLimiter, validate({ body: s.loginSchema }), auth.login);
  r.post('/auth/register', authLimiter, validate({ body: s.registerSchema }), auth.register);
  r.post('/auth/logout', auth.logout);
  r.get('/auth/username/check', auth.checkUsername);

  r.get('/me', auth.me);
  r.put(
    '/me/preferences',
    requireAuth,
    validate({ body: s.preferencesSchema }),
    auth.setPreferences,
  );
  r.put('/me/avatar', requireAuth, validate({ body: avatarBody }), users.setAvatar);
  r.get('/me/submissions', requireAuth, validate({ query: s.pageQuery }), users.submissions);
  r.get('/me/answers', requireAuth, validate({ query: s.pageQuery }), users.answers);
  r.get('/me/companies', requireAuth, validate({ query: s.pageQuery }), companies.mine);
  r.get('/me/bookmarks', requireAuth, validate({ query: s.pageQuery }), users.bookmarks);
  r.get('/me/progress', requireAuth, users.progress);
  r.get('/me/activity', requireAuth, users.activity);
  r.get('/me/notifications', requireAuth, validate({ query: s.cursorQuery }), users.notifications);
  r.post('/me/notifications/read', requireAuth, users.readNotifications);
  r.get('/me/lists', requireAuth, users.lists);
  r.post('/me/lists', requireAuth, validate({ body: s.listNameSchema }), users.createList);
  r.get('/me/lists/:id', requireAuth, users.list);
  r.patch('/me/lists/:id', requireAuth, validate({ body: s.listNameSchema }), users.renameList);
  r.delete('/me/lists/:id', requireAuth, users.deleteList);
  r.put('/me/lists/:id/questions/:questionId', requireAuth, users.listItem(true));
  r.delete('/me/lists/:id/questions/:questionId', requireAuth, users.listItem(false));

  r.get('/me/role-requests', requireAuth, noStore, roleRequests.mine);
  r.get('/roles/requestable', requireAuth, roleRequests.requestable);
  r.post(
    '/role-requests',
    requireAuth,
    validate({ body: s.roleRequestSchema }),
    roleRequests.create,
  );

  r.get('/meta', users.meta);
  r.get('/users/:username', users.publicProfile);
  r.get('/users/:username/:tab', validate({ query: s.pageQuery }), users.contributions);

  // ---- companies ----
  r.get('/companies', validate({ query: s.companyListQuery }), companies.list);
  r.get('/companies/:slug', companies.get);
  r.get(
    '/companies/:slug/questions',
    validate({ query: s.questionListQuery }),
    companies.questions,
  );
  r.get(
    '/companies/:slug/questions/:qslug',
    validate({ query: s.questionListQuery }),
    companies.question,
  );
  r.get('/companies/:slug/comments', validate({ query: s.threadQuery }), companies.comments);
  r.post(
    '/companies/:slug/comments',
    requirePermission('comments.create'),
    validate({ body: s.postSchema }),
    screenText('comment', ['body']),
    companies.addComment,
  );
  r.get('/companies/:slug/reviews', validate({ query: s.reviewQuery }), companies.reviews);
  r.put(
    '/companies/:slug/reviews/mine',
    requirePermission('ratings.create'),
    validate({ body: s.reviewSchema }),
    screenText('review', ['title', 'body']),
    companies.upsertReview,
  );
  r.post(
    '/companies',
    requirePermission('companies.submit'),
    validate({ body: s.companySubmitSchema }),
    logged('create', 'company'),
    companies.create,
  );
  r.patch(
    '/companies/:id',
    requirePermission('companies.edit'),
    validate({ body: s.companyInputSchema.partial() }),
    logged('edit', 'company'),
    companies.update,
  );
  r.delete(
    '/companies/:id',
    requirePermission('companies.delete'),
    logged('delete', 'company'),
    companies.remove,
  );

  // ---- questions ----
  r.get('/questions/search', validate({ query: searchQuery }), questions.search);
  r.get('/questions/recent', questions.recent);
  r.get('/questions/daily', questions.daily);
  r.get('/questions/:id/related', questions.related);
  r.get('/questions/:id/answers', validate({ query: s.threadQuery }), questions.answers);
  r.post(
    '/questions/:id/answers',
    requirePermission('answers.create'),
    validate({ body: s.postSchema }),
    screenText('answer', ['body']),
    questions.addAnswer,
  );
  r.post(
    '/questions',
    requirePermission('questions.create'),
    validate({ body: s.submitQuestionSchema }),
    screenText('question', ['title', 'problem', 'examples', 'constraints', 'lookFor', 'followUps']),
    logged('create', 'question'),
    questions.submit,
  );
  r.post(
    '/questions/bulk',
    requirePermission('questions.create'),
    validate({ body: s.bulkQuestionsSchema }),
    screenText('question', ['questions'], (d) => d.ids),
    logged('create', 'question'),
    questions.submitMany,
  );
  r.post(
    '/questions/:id/asked',
    requirePermission('questions.create'),
    validate({ body: s.askedSchema }),
    questions.asked,
  );
  r.patch(
    '/questions/:id',
    requirePermission('questions.edit_any'),
    validate({ body: s.questionInputSchema.partial() }),
    logged('edit', 'question'),
    questions.edit,
  );
  r.delete(
    '/questions/:id',
    requirePermission('questions.delete_any'),
    logged('delete', 'question'),
    questions.remove,
  );
  r.put('/questions/:id/bookmark', requireAuth, questions.bookmark(true));
  r.delete('/questions/:id/bookmark', requireAuth, questions.bookmark(false));
  r.put('/questions/:id/studied', requireAuth, questions.studied(true));
  r.delete('/questions/:id/studied', requireAuth, questions.studied(false));

  // ---- posts, votes, reports ----
  r.patch(
    '/answers/:id',
    requireAuth,
    validate({ body: s.editPostSchema }),
    screenText('answer', ['body']),
    posts.editAnswer,
  );
  r.delete('/answers/:id', requireAuth, posts.deleteAnswer);
  r.patch(
    '/comments/:id',
    requireAuth,
    validate({ body: s.editPostSchema }),
    screenText('comment', ['body']),
    posts.editComment,
  );
  r.delete('/comments/:id', requireAuth, posts.deleteComment);
  r.delete('/reviews/:id', requireAuth, posts.deleteReview);
  r.put('/votes', requirePermission('answers.vote'), validate({ body: s.voteSchema }), posts.vote);
  r.post('/reports', requireAuth, validate({ body: s.reportSchema }), posts.report);

  // ---- activity log, undo / redo ----
  r.get('/history', requireAuth, noStore, validate({ query: s.historyQuery }), history.list);
  r.get('/history/stacks', requireAuth, noStore, history.stacks);
  r.post('/history/undo', requireAuth, history.undo);
  r.post('/history/redo', requireAuth, history.redo);

  // ---- messages ----
  r.get('/messages', requireAuth, validate({ query: s.messagesQuery }), messages.list);
  r.get('/messages/recipients', requirePermission('messages.send_any'), messages.recipients);
  r.get('/messages/:id', requireAuth, messages.get);
  r.post(
    '/messages',
    requireAuth,
    messageLimiter,
    validate({ body: s.startMessageSchema }),
    screenText('message', ['subject', 'body'], (d) => d.messageId),
    messages.start,
  );
  r.post(
    '/messages/:id/reply',
    requireAuth,
    messageLimiter,
    validate({ body: s.replyMessageSchema }),
    screenText('message', ['body'], (d) => d.messageId),
    messages.reply,
  );

  // ---- moderation & admin ----
  r.get('/admin/counts', requireAuth, users.adminCounts);
  r.get('/admin/analytics', requirePermission('analytics.view'), noStore, users.analytics);
  r.get(
    '/admin/review',
    requirePermission('questions.review'),
    validate({ query: s.pageQuery }),
    questions.queue,
  );
  r.post(
    '/admin/review/:id/approve',
    requirePermission('questions.review'),
    validate({ body: s.approveSchema }),
    logged('approve', 'question'),
    questions.approve,
  );
  r.post(
    '/admin/review/:id/reject',
    requirePermission('questions.review'),
    validate({ body: s.rejectSchema }),
    logged('reject', 'question', bodyField('reason')),
    questions.reject,
  );
  r.get(
    '/admin/company-review',
    requirePermission('companies.review'),
    validate({ query: s.pageQuery }),
    companies.queue,
  );
  r.post(
    '/admin/company-review/:id/approve',
    requirePermission('companies.review'),
    validate({ body: s.companyApproveSchema }),
    logged('approve', 'company'),
    companies.approve,
  );
  r.post(
    '/admin/company-review/:id/reject',
    requirePermission('companies.review'),
    validate({ body: s.rejectSchema }),
    logged('reject', 'company', bodyField('reason')),
    companies.reject,
  );
  r.get(
    '/admin/reports',
    requirePermission('reports.review'),
    validate({ query: s.reportsQuery }),
    posts.reports,
  );
  r.post(
    '/admin/reports/:id',
    requirePermission('reports.review'),
    validate({ body: s.handleReportSchema }),
    posts.handleReport,
  );
  r.get(
    '/admin/companies',
    requireAnyPermission('companies.review', 'companies.edit', 'companies.delete'),
    validate({ query: s.pageQuery }),
    companies.adminList,
  );

  r.get(
    '/admin/users',
    requirePermission('users.view_private'),
    noStore,
    validate({ query: s.usersQuery }),
    users.listUsers,
  );
  r.get('/admin/users/:id', requirePermission('users.view_private'), noStore, users.userDetail);

  r.get(
    '/admin/role-requests',
    requirePermission('users.assign_roles'),
    noStore,
    validate({ query: s.pageQuery }),
    roleRequests.pending,
  );
  r.post(
    '/admin/role-requests/:id/approve',
    requirePermission('users.assign_roles'),
    logged('approve', 'roleRequest'),
    roleRequests.approve,
  );
  r.post(
    '/admin/role-requests/:id/reject',
    requirePermission('users.assign_roles'),
    validate({ body: s.rejectRoleRequestSchema }),
    logged('reject', 'roleRequest', bodyField('note')),
    roleRequests.reject,
  );

  r.get(
    '/admin/user-lookup',
    requireAnyPermission('users.assign_roles', 'users.ban'),
    users.lookup,
  );
  r.put(
    '/admin/users/:id/role',
    requirePermission('users.assign_roles'),
    validate({ body: s.assignRoleSchema }),
    logged('role', 'user', async (req) => {
      const role = await RoleRepository.findById(String(req.body.roleId)).catch(() => null);
      return role?.name ?? '';
    }),
    users.assignRoles,
  );
  r.put(
    '/admin/users/:id/status',
    requirePermission('users.ban'),
    validate({ body: s.userStatusSchema }),
    logged('status', 'user', (req) =>
      [req.body.status, req.body.reason].filter(Boolean).join(' · '),
    ),
    users.setStatus,
  );
  r.get(
    '/admin/roles',
    requireAnyPermission('roles.manage', 'users.assign_roles', 'users.view_private'),
    users.roles,
  );
  r.post(
    '/admin/roles',
    requirePermission('roles.manage'),
    validate({ body: s.roleSchema }),
    logged('create', 'role'),
    users.createRole,
  );
  r.patch(
    '/admin/roles/:id',
    requirePermission('roles.manage'),
    validate({ body: s.roleSchema.partial() }),
    logged('edit', 'role'),
    users.updateRole,
  );
  r.delete(
    '/admin/roles/:id',
    requirePermission('roles.manage'),
    logged('delete', 'role'),
    users.deleteRole,
  );

  return r;
}
