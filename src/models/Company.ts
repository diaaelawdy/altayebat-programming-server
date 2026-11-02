import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameAr: { type: String, default: '' },
    slug: { type: String, required: true, unique: true },
    logoUrl: { type: String, default: '' },
    website: { type: String, default: '' },
    linkedinUrl: { type: String, default: '' },
    industry: { type: String, default: '' },
    description: { type: String, default: '' },
    questionCount: { type: Number, default: 0 },
    lastUpdatedAt: { type: Date, default: null },
    status: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
    rejectionReason: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rating: {
      count: { type: Number, default: 0 },
      overall: { type: Number, default: 0 },
      experience: { type: Number, default: 0 },
      difficulty: { type: Number, default: 0 },
      communication: { type: Number, default: 0 },
      distribution: { type: [Number], default: [0, 0, 0, 0, 0] },
    },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

companySchema.index({ status: 1, questionCount: -1 });
companySchema.index({ status: 1, name: 1 });
companySchema.index({ createdBy: 1, status: 1, createdAt: -1 });

export type CompanyDoc = InferSchemaType<typeof companySchema> & { _id: Types.ObjectId };
export const Company = model('Company', companySchema);
