/**
 * Fixed permission catalog. Keep in sync with client/src/shared/permissions.ts.
 */
export const PERMISSIONS = {
  'questions.create': 'Submit questions for review',
  'questions.review': 'Approve or reject submitted questions',
  'questions.edit_any': 'Edit any question',
  'questions.delete_any': 'Delete any question',
  'answers.create': 'Post answers and replies',
  'answers.vote': 'Vote on answers, comments and reviews',
  'answers.delete_any': 'Delete any answer',
  'comments.create': 'Post company feedback comments',
  'comments.delete_any': 'Delete any feedback comment',
  'ratings.create': 'Rate and review companies',
  'ratings.delete_any': 'Delete any company review',
  'reports.review': 'Handle reported content',
  'moderation.view_reviewer': 'See who approved or rejected each question and company',
  'companies.submit': 'Suggest new companies (published after review)',
  'companies.review': 'Approve or reject suggested companies',
  'companies.edit': 'Edit companies',
  'companies.delete': 'Delete companies',
  'users.view_private': 'View the users admin page with contribution details',
  'users.ban': 'Ban and unban users',
  'users.assign_roles': 'Assign roles to users',
  'roles.manage': 'Create, edit and delete roles',
  'messages.team_inbox': 'Read and answer messages sent to the team',
  'messages.send_any': 'Send a message to any user',
  'logs.view': 'See the activity log of everyone',
  'analytics.view': 'See site analytics (users, questions, comments)',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const MEMBER_PERMISSIONS: Permission[] = [
  'questions.create',
  'answers.create',
  'answers.vote',
  'comments.create',
  'ratings.create',
  'companies.submit',
];

export const FOUNDER_ROLE = 'Founder';
export const MEMBER_ROLE = 'Member';
export const REVIEWER_ROLE = 'Reviewer';

/** A Member who can also review new companies and questions. */
export const REVIEWER_PERMISSIONS: Permission[] = [
  ...MEMBER_PERMISSIONS,
  'questions.review',
  'companies.review',
];

export function isPermission(key: string): key is Permission {
  return key in PERMISSIONS;
}
