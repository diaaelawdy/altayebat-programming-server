// Vercel serverless entry: reuses the compiled Express app from dist/.
import { config } from '../dist/config/env.js';
import { connectDb } from '../dist/db/connection.js';
import { createApp } from '../dist/app.js';
import { startVpnList } from '../dist/lib/vpn.js';

const c = config();
await connectDb(c.MONGO_URI);
void startVpnList();

export default createApp();
