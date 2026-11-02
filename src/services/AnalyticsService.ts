import { Answer, CompanyComment, CompanyReview, Question, User } from '../models/index.js';

const DAY = 24 * 60 * 60 * 1000;

/** Site-wide totals for the analytics page (`analytics.view`). */
export const AnalyticsService = {
  async overview() {
    const weekAgo = new Date(Date.now() - 7 * DAY);
    // Submitted = added by a member (imported questions have no author).
    const submitted = { authorId: { $ne: null } };
    const alive = { deletedAt: null };
    const [
      users,
      usersThisWeek,
      questionsLive,
      submittedTotal,
      submittedThisWeek,
      approved,
      pending,
      rejected,
      answers,
      companyComments,
      reviews,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      Question.countDocuments({ status: 'approved' }),
      Question.countDocuments(submitted),
      Question.countDocuments({ ...submitted, createdAt: { $gte: weekAgo } }),
      Question.countDocuments({ ...submitted, status: 'approved' }),
      Question.countDocuments({ ...submitted, status: 'pending' }),
      Question.countDocuments({ ...submitted, status: 'rejected' }),
      Answer.countDocuments(alive),
      CompanyComment.countDocuments(alive),
      CompanyReview.countDocuments(),
    ]);
    return {
      users: { total: users, thisWeek: usersThisWeek },
      questions: {
        live: questionsLive,
        submitted: submittedTotal,
        submittedThisWeek,
        approved,
        pending,
        rejected,
      },
      comments: { total: answers + companyComments, answers, companyComments },
      reviews,
    };
  },
};
