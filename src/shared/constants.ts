/** Keep in sync with client/src/shared/constants.ts. */

/*
 * Question tags. Every question is tagged with one value (or a few) per facet,
 * always shown in this order: Field · Specialization · Level · Stage · Difficulty · Topic.
 */
export const FIELDS = ['Software', 'Data', 'Product', 'Design', 'Business', 'General'] as const;
export type FieldName = (typeof FIELDS)[number];

/** Each specialization belongs to exactly one field; General (any role) has none. */
export const SPECIALIZATIONS_BY_FIELD = {
  Software: [
    'Backend',
    'Frontend',
    'Full-stack',
    'Mobile',
    'DevOps & Cloud',
    'QA & Testing',
    'Security',
    'Embedded',
  ],
  Data: ['Data Engineering', 'Data Science', 'Data Analysis', 'ML & AI'],
  Product: ['Product Management'],
  Design: ['UI/UX Design'],
  Business: ['Operations', 'Business Analysis', 'Sales & Commercial'],
  General: [],
} as const satisfies Record<FieldName, readonly string[]>;
export type Specialization = (typeof SPECIALIZATIONS_BY_FIELD)[FieldName][number];

export const SPECIALIZATIONS = FIELDS.flatMap(
  (f): readonly Specialization[] => SPECIALIZATIONS_BY_FIELD[f],
) as unknown as readonly [Specialization, ...Specialization[]];

export const LEVELS = ['Intern', 'Junior', 'Mid', 'Senior'] as const;

export const TOPICS = [
  'Problem Solving (DSA)',
  'System Design',
  'OOP & Design Patterns',
  'SQL & Databases',
  'CS Fundamentals',
  'Tools & Frameworks',
  'Behavioral',
  'HR & Salary',
  'Past Projects',
  'Business & Product Case',
  'Aptitude & IQ',
] as const;

/** The field a specialization belongs to. */
export const fieldOf = (specialization: string): FieldName | undefined =>
  FIELDS.find((f) => (SPECIALIZATIONS_BY_FIELD[f] as readonly string[]).includes(specialization));

/** True when every specialization belongs to `field`. */
export const specializationsFit = (field: string, specializations: readonly string[]) =>
  specializations.every((s) => fieldOf(s) === field);

export const STAGES = [
  'Online Assessment',
  'Phone Screen',
  'Technical Interview',
  'Onsite',
  'HR Interview',
  'Final Round',
  'Take-home Task',
] as const;

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;

export const REVIEW_OUTCOMES = [
  'offer',
  'rejected',
  'no_response',
  'in_progress',
  'declined',
] as const;

/** 3–20 chars: letters, numbers, `_` or `-`; must not start with a number. Stored lowercase. */
export const USERNAME_RE = /^[a-z_-][a-z0-9_-]{2,19}$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Anonymous avatars: an icon on a color, stored as `icon:color`. Keep in sync with the client. */
export const AVATAR_ICONS = [
  'ghost',
  'venetian-mask',
  'drama',
  'hat-glasses',
  'glasses',
  'eye-off',
  'cat',
  'dog',
  'bird',
  'fish',
  'rabbit',
  'squirrel',
  'turtle',
  'snail',
  'panda',
  'bot',
  'rocket',
  'moon',
  'orbit',
  'origami',
] as const;
export const AVATAR_COLORS = [
  'violet',
  'blue',
  'cyan',
  'green',
  'amber',
  'orange',
  'rose',
  'slate',
] as const;
export const isAvatar = (v: string) => {
  const [icon, color] = v.split(':');
  return (
    (AVATAR_ICONS as readonly string[]).includes(icon ?? '') &&
    (AVATAR_COLORS as readonly string[]).includes(color ?? '')
  );
};
export const randomAvatar = () =>
  `${AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)]}:${
    AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
  }`;
