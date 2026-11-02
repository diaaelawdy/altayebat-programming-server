import { Schema, model } from 'mongoose';

const bookmarkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  },
  { timestamps: true },
);
bookmarkSchema.index({ userId: 1, questionId: 1 }, { unique: true });
bookmarkSchema.index({ userId: 1, createdAt: -1 });
export const Bookmark = model('Bookmark', bookmarkSchema);

const studyProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  },
  { timestamps: true },
);
studyProgressSchema.index({ userId: 1, questionId: 1 }, { unique: true });
studyProgressSchema.index({ userId: 1, companyId: 1 });
export const StudyProgress = model('StudyProgress', studyProgressSchema);

const studyListSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
  },
  { timestamps: true },
);
export const StudyList = model('StudyList', studyListSchema);

const activityDaySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD (Africa/Cairo)
  count: { type: Number, default: 0 },
});
activityDaySchema.index({ userId: 1, day: 1 }, { unique: true });
export const ActivityDay = model('ActivityDay', activityDaySchema);
