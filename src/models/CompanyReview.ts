import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const stars = { type: Number, min: 1, max: 5, required: true };

const companyReviewSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    overall: stars,
    experience: stars,
    difficulty: stars,
    communication: stars,
    outcome: { type: String, default: '' },
    specialization: { type: String, default: '' },
    level: { type: String, default: '' },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    score: { type: Number, default: 0 },
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

companyReviewSchema.index({ companyId: 1, authorId: 1 }, { unique: true });
companyReviewSchema.index({ companyId: 1, deletedAt: 1, score: -1, createdAt: -1 });
companyReviewSchema.index({ companyId: 1, deletedAt: 1, createdAt: -1 });
companyReviewSchema.index({ authorId: 1 });

export type CompanyReviewDoc = InferSchemaType<typeof companyReviewSchema> & {
  _id: Types.ObjectId;
};
export const CompanyReview = model('CompanyReview', companyReviewSchema);
