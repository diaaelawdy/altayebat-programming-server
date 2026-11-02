import mongoose from 'mongoose';

let connecting: Promise<typeof mongoose> | null = null;

/** Singleton connection shared by the app, seed script and tests. */
export function connectDb(uri: string): Promise<typeof mongoose> {
  if (!connecting) {
    mongoose.set('strictQuery', true);
    connecting = mongoose.connect(uri, { autoIndex: true });
  }
  return connecting;
}

export async function disconnectDb(): Promise<void> {
  connecting = null;
  await mongoose.disconnect();
}
