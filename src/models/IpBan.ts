import { Schema, model } from 'mongoose';

/** A banned IP, stored only as a keyed hash. Removed when its user is unbanned. */
const ipBanSchema = new Schema(
  {
    hash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
ipBanSchema.index({ userId: 1 });

export const IpBan = model('IpBan', ipBanSchema);
