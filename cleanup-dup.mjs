import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('./.env.local','utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(m[1]);
const converted = await sql`SELECT DISTINCT phone FROM abandoned_orders WHERE status='converted'`;
console.log('converted phones', converted.length);
let totalDeleted = 0;
for (const {phone} of converted) {
  const del = await sql`DELETE FROM abandoned_orders WHERE phone=${phone} AND status IN ('pending','abandoned') RETURNING id`;
  if (del.length) {
    console.log(`deleted ${del.length} for ${phone}`);
    totalDeleted += del.length;
  }
}
console.log('total deleted', totalDeleted);
const remaining = await sql`SELECT status, count(*) FROM abandoned_orders GROUP BY status`;
console.log(remaining);
