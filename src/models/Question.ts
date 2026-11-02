import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const questionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    slug: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    // Tags (see shared/constants.ts): Field · Specialization · Level · Stage · Difficulty · Topic.
    field: { type: String, required: true },
    specializations: [{ type: String }],
    // Empty on questions imported or migrated without a known level.
    levels: [{ type: String }],
    stage: { type: String, required: true },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
    topics: [{ type: String }],
    problem: { type: String, required: true },
    problemHtml: { type: String, default: '' },
    examples: [{ input: String, output: String, explanation: String, _id: false }],
    constraints: [{ type: String }],
    lookFor: { type: String, default: '' },
    lookForHtml: { type: String, default: '' },
    followUps: [{ type: String }],
    timesAsked: { type: Number, default: 1 },
    lastAskedAt: { type: Date, default: () => new Date() },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, default: '' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    answerCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

questionSchema.index({ companyId: 1, slug: 1 }, { unique: true });
questionSchema.index({ companyId: 1, status: 1, lastAskedAt: -1, _id: -1 });
questionSchema.index({ companyId: 1, status: 1, timesAsked: -1, _id: -1 });
questionSchema.index({ companyId: 1, status: 1, publishedAt: -1, _id: -1 });
questionSchema.index({ status: 1, publishedAt: -1, _id: -1 });
questionSchema.index({ status: 1, createdAt: 1 });
questionSchema.index({ authorId: 1, createdAt: -1 });
questionSchema.index({ title: 'text', problem: 'text' }, { weights: { title: 5, problem: 1 } });

export type QuestionDoc = InferSchemaType<typeof questionSchema> & { _id: Types.ObjectId };
export const Question = model('Question', questionSchema);
