import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('./.env.local','utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(m[1]);
// Simulate fetchProductByHandle
const handle = '999';
const product = await sql`SELECT * FROM products WHERE handle=${handle} AND status='ACTIVE' AND visibility=true AND show_in_store=true AND deleted_at IS NULL`;
console.log(product);
