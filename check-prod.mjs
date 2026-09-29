import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('./.env.local','utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(m[1]);
const rows = await sql`SELECT id, handle, name, status, visibility, show_in_store, deleted_at FROM products WHERE id='999' OR handle='999' OR handle LIKE '%999%'`;
console.log(rows);
const all = await sql`SELECT id, handle, name, status FROM products LIMIT 5`;
console.log('all', all);
