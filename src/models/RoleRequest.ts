import { Schema, model } from 'mongoose';

/** A member asking for a role, with why. Staff with `users.assign_roles` approve or reject it. */
const roleRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    // Why it was rejected (optional), shown to the requester.
    note: { type: String, default: '' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
  },
  { timestamps: true },
);
roleRequestSchema.index({ status: 1, createdAt: -1 });
roleRequestSchema.index({ userId: 1, createdAt: -1 });
// One open request per user.
roleRequestSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

export const RoleRequest = model('RoleRequest', roleRequestSchema);
