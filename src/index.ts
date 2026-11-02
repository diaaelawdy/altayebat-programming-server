import { config } from './config/env.js';
import { connectDb } from './db/connection.js';
import { createApp } from './app.js';
import { startVpnList } from './lib/vpn.js';

const c = config();
await connectDb(c.MONGO_URI);
void startVpnList();
createApp().listen(c.PORT, () => console.log(`API listening on ${c.SERVER_URL} (${c.NODE_ENV})`));
