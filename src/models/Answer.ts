import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { threadFields } from './threadFields.js';

const answerSchema = new Schema(
  { questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true }, ...threadFields },
  { timestamps: true },
);

answerSchema.index({ questionId: 1, parentId: 1, score: -1, createdAt: -1 });
answerSchema.index({ questionId: 1, parentId: 1, createdAt: -1 });
answerSchema.index({ rootId: 1, createdAt: 1 });
answerSchema.index({ authorId: 1, createdAt: -1 });

export type AnswerDoc = InferSchemaType<typeof answerSchema> & { _id: Types.ObjectId };
export const Answer = model('Answer', answerSchema);
