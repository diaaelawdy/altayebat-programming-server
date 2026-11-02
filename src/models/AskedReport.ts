import { Schema, model } from 'mongoose';

const askedReportSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    month: { type: String, required: true }, // YYYY-MM
    specialization: { type: String, default: '' },
    level: { type: String, default: '' },
    stage: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

askedReportSchema.index({ questionId: 1, userId: 1 }, { unique: true });

export const AskedReport = model('AskedReport', askedReportSchema);
