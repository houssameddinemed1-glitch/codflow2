import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('./.env.local','utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(m[1]);
const keys = await sql`SELECT key_hash, name FROM store_api_keys LIMIT 1`;
console.log(keys);
const store = await sql`SELECT id, name FROM stores LIMIT 1`;
console.log(store);
