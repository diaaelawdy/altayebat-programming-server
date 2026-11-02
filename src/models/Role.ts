import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const roleSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    permissions: [{ type: String }],
    isSystem: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    // Founder implicitly holds every permission, including future ones.
    isFounder: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type RoleDoc = InferSchemaType<typeof roleSchema> & { _id: Types.ObjectId };
export const Role = model('Role', roleSchema);
