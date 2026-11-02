import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { threadFields } from './threadFields.js';

const companyCommentSchema = new Schema(
  { companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, ...threadFields },
  { timestamps: true },
);

companyCommentSchema.index({ companyId: 1, parentId: 1, score: -1, createdAt: -1 });
companyCommentSchema.index({ companyId: 1, parentId: 1, createdAt: -1 });
companyCommentSchema.index({ rootId: 1, createdAt: 1 });
companyCommentSchema.index({ authorId: 1, createdAt: -1 });

export type CompanyCommentDoc = InferSchemaType<typeof companyCommentSchema> & {
  _id: Types.ObjectId;
};
export const CompanyComment = model('CompanyComment', companyCommentSchema);
