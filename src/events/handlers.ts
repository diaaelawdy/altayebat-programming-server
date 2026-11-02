import {
  AnswerRepository,
  CompanyCommentRepository,
  CompanyRepository,
  QuestionRepository,
  StudyRepository,
  UserRepository,
} from '../repositories/index.js';
import { events } from './bus.js';
import { CompanyService } from '../services/CompanyService.js';
import { GamificationService, QUESTION_APPROVED_REP } from '../services/GamificationService.js';
import { NotificationService } from '../services/NotificationService.js';
import { ReviewService } from '../services/ReviewService.js';

let registered = false;

/** Wires side effects (counters, reputation, badges, notifications) to domain events. */
export function registerEventHandlers() {
  if (registered) return;
  registered = true;

  const questionLink = async (questionId: Parameters<typeof QuestionRepository.findById>[0]) => {
    const q = await QuestionRepository.findById(questionId);
    const c = q && (await CompanyRepository.findById(q.companyId));
    return q && c
      ? { q, data: { questionTitle: q.title, companySlug: c.slug, questionSlug: q.slug } }
      : null;
  };

  events.on('question.submitted', async ({ authorId }) => {
    await UserRepository.incStat(authorId, 'questionsSubmitted');
    await GamificationService.recordActivity(authorId);
  });

  events.on('question.approved', async ({ questionId, companyId, authorId }) => {
    await CompanyService.refreshCounters(companyId);
    if (!authorId) return;
    await UserRepository.incStat(authorId, 'questionsApproved');
    await UserRepository.incReputation(authorId, QUESTION_APPROVED_REP);
    const link = await questionLink(questionId);
    await NotificationService.notify(authorId, 'question.approved', link?.data ?? {});
    const user = await UserRepository.findById(authorId);
    const approved = user?.stats?.questionsApproved ?? 0;
    if (approved >= 1) await GamificationService.award(authorId, 'first_question');
    if (approved >= 5) await GamificationService.award(authorId, 'contributor');
  });

  events.on('question.rejected', async ({ questionId, authorId, reason }) => {
    if (!authorId) return;
    await UserRepository.incStat(authorId, 'questionsRejected');
    const q = await QuestionRepository.findById(questionId);
    await NotificationService.notify(authorId, 'question.rejected', {
      questionTitle: q?.title ?? '',
      reason,
    });
  });

  events.on('company.approved', async ({ companyId, authorId }) => {
    const c = await CompanyRepository.findById(companyId);
    await NotificationService.notify(authorId, 'company.approved', {
      companySlug: c?.slug ?? '',
      companyName: c?.name ?? '',
    });
  });

  events.on('company.rejected', async ({ companyId, authorId, reason }) => {
    const c = await CompanyRepository.findById(companyId);
    await NotificationService.notify(authorId, 'company.rejected', {
      companyName: c?.name ?? '',
      reason,
    });
  });

  events.on('question.deleted', async ({ companyId, wasApproved }) => {
    if (wasApproved) await CompanyService.refreshCounters(companyId);
  });

  events.on('question.asked', async ({ companyId, userId }) => {
    await CompanyService.refreshCounters(companyId);
    await GamificationService.recordActivity(userId);
  });

  events.on('answer.created', async ({ questionId, parentId, authorId }) => {
    await UserRepository.incStat(authorId, 'answers');
    await GamificationService.award(authorId, 'first_answer');
    await GamificationService.recordActivity(authorId);
    const actor = (await UserRepository.publicRefs([authorId])).get(String(authorId));
    const link = await questionLink(questionId);
    if (!parentId) {
      await QuestionRepository.inc(questionId, { answerCount: 1 });
      const qAuthor = link?.q.authorId;
      if (qAuthor && String(qAuthor) !== String(authorId)) {
        await NotificationService.notify(qAuthor, 'question.answered', {
          ...link?.data,
          actor: actor?.username,
        });
      }
    } else {
      const parent = await AnswerRepository.inc(parentId, { replyCount: 1 });
      if (parent && String(parent.authorId) !== String(authorId)) {
        await NotificationService.notify(parent.authorId, 'answer.reply', {
          ...link?.data,
          actor: actor?.username,
        });
      }
    }
  });

  events.on('answer.deleted', async ({ questionId, parentId, authorId }) => {
    await UserRepository.incStat(authorId, 'answers', -1);
    if (!parentId) await QuestionRepository.inc(questionId, { answerCount: -1 });
    else await AnswerRepository.inc(parentId, { replyCount: -1 });
  });

  events.on('answer.restored', async ({ questionId, parentId, authorId }) => {
    await UserRepository.incStat(authorId, 'answers');
    if (!parentId) await QuestionRepository.inc(questionId, { answerCount: 1 });
    else await AnswerRepository.inc(parentId, { replyCount: 1 });
  });

  events.on('comment.restored', async ({ companyId, parentId }) => {
    await CompanyRepository.inc(companyId, { commentCount: 1 });
    if (parentId) await CompanyCommentRepository.inc(parentId, { replyCount: 1 });
  });

  events.on('comment.created', async ({ companyId, parentId, authorId }) => {
    await UserRepository.incStat(authorId, 'comments');
    await CompanyRepository.inc(companyId, { commentCount: 1 });
    await GamificationService.recordActivity(authorId);
    if (parentId) {
      const parent = await CompanyCommentRepository.inc(parentId, { replyCount: 1 });
      if (parent && String(parent.authorId) !== String(authorId)) {
        const [company, refs] = await Promise.all([
          CompanyRepository.findById(companyId),
          UserRepository.publicRefs([authorId]),
        ]);
        await NotificationService.notify(parent.authorId, 'comment.reply', {
          companySlug: company?.slug,
          companyName: company?.name,
          actor: refs.get(String(authorId))?.username,
        });
      }
    }
  });

  events.on('comment.deleted', async ({ companyId, parentId }) => {
    await CompanyRepository.inc(companyId, { commentCount: -1 });
    if (parentId) await CompanyCommentRepository.inc(parentId, { replyCount: -1 });
  });

  events.on(
    'vote.cast',
    async ({ targetType, targetId, targetAuthorId, voterId, previous, value, newScore }) => {
      const rep = GamificationService.voteReputation(targetType, previous, value);
      if (rep) await UserRepository.incReputation(targetAuthorId, rep);
      if (previous === 0 || value === 0) {
        await UserRepository.incStat(voterId, 'votesCast', value === 0 ? -1 : 1);
      }
      const voter = await UserRepository.findById(voterId);
      if ((voter?.stats?.votesCast ?? 0) >= 25) await GamificationService.award(voterId, 'voter');
      if (targetType === 'answer') {
        if (newScore >= 10) await GamificationService.award(targetAuthorId, 'helpful');
        if (previous === 0 && value === 1) {
          const a = await AnswerRepository.findById(targetId);
          const link = a && (await questionLink(a.questionId as never));
          await NotificationService.notify(targetAuthorId, 'vote.up', link?.data ?? {});
        }
      }
    },
  );

  events.on('review.changed', async ({ companyId, authorId, created }) => {
    await ReviewService.recompute(companyId);
    if (created) {
      await UserRepository.incStat(authorId, 'reviews');
      await GamificationService.award(authorId, 'first_review');
      await GamificationService.recordActivity(authorId);
    }
  });

  events.on('study.marked', async ({ userId, companyId }) => {
    await UserRepository.incStat(userId, 'studied');
    await GamificationService.recordActivity(userId);
    const [total, company] = await Promise.all([
      StudyRepository.studiedCount(userId),
      CompanyRepository.findById(companyId),
    ]);
    if (total >= 10) await GamificationService.award(userId, 'studied_10');
    if (total >= 50) await GamificationService.award(userId, 'studied_50');
    if (company && company.questionCount > 0) {
      const done = await StudyRepository.studiedCountFor(userId, companyId);
      if (done >= company.questionCount)
        await GamificationService.award(userId, 'company_complete');
    }
  });
}
