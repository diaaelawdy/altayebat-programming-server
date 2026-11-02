import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const preferencesSchema = new Schema(
  {
    locale: { type: String, enum: ['en', 'ar'], default: 'en' },
    mode: { type: String, enum: ['dark', 'light', 'system'], default: 'dark' },
    accent: { type: String, default: null },
    dark: { bg: String, surface: String, fg: String },
    light: { bg: String, surface: String, fg: String },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    // No email, no real name: a username and a password hash are the whole identity.
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    roleIds: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    // disabled: read-only, no IP ban. banned: only the ban screen, every IP banned.
    status: { type: String, enum: ['active', 'disabled', 'banned'], default: 'active' },
    ban: {
      reason: { type: String, default: '' },
      link: { type: String, default: '' },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
      // Whether the restricted account can still send and receive messages.
      canMessage: { type: Boolean, default: true },
    },
    // Keyed hashes of recent IPs (never raw IPs), used to ban every IP of a banned user.
    ipHashes: { type: [String], default: [], select: false },
    avatar: { type: String, default: null },
    permissionsVersion: { type: Number, default: 0 },
    reputation: { type: Number, default: 0 },
    badges: [{ key: String, awardedAt: Date, _id: false }],
    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      lastDay: { type: String, default: null },
    },
    stats: {
      questionsSubmitted: { type: Number, default: 0 },
      questionsApproved: { type: Number, default: 0 },
      questionsRejected: { type: Number, default: 0 },
      answers: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      reviews: { type: Number, default: 0 },
      votesCast: { type: Number, default: 0 },
      studied: { type: Number, default: 0 },
    },
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  { timestamps: true },
);

userSchema.index({ createdAt: -1 });
userSchema.index({ roleIds: 1 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model('User', userSchema);
