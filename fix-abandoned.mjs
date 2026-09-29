import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('./.env.local','utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(m[1]);
// Sweep pending older than 30min
const cutoff = new Date(Date.now() - 30*60*1000).toISOString();
console.log('cutoff', cutoff);
const swept = await sql`UPDATE abandoned_orders SET status='abandoned', updated_at=${new Date().toISOString()} WHERE status='pending' AND created_at < ${cutoff} RETURNING id, phone, customer_name, created_at`;
console.log('swept', swept.length, swept.slice(0,3));
// Deduplicate: for هنوس phone 0558919782, if there's a converted and a pending for same phone, delete the pending
const dups = await sql`SELECT phone, count(*) FROM abandoned_orders WHERE phone='0558919782' GROUP BY phone`;
console.log(dups);
const all = await sql`SELECT id, phone, status, created_at, converted_order_number FROM abandoned_orders WHERE phone='0558919782' ORDER BY created_at`;
console.log(all);
// For any phone that has a converted, delete other pending/abandoned for same phone that have no converted_order_id
const convertedPhones = await sql`SELECT DISTINCT phone FROM abandoned_orders WHERE status='converted'`;
console.log('converted phones', convertedPhones.map(r=>r.phone));
for (const {phone} of convertedPhones) {
  const others = await sql`SELECT id, status FROM abandoned_orders WHERE phone=${phone} AND status != 'converted'`;
  if (others.length > 0) {
    console.log(`phone ${phone} has ${others.length} non-converted rows, deleting pending duplicates`);
    // Delete pending that are duplicates (same phone, not converted)
    // Keep the converted, delete the other pendings that were created before the converted's created_at?
    // For now, just delete pending that have same phone and created before the converted
    const convertedTime = (await sql`SELECT created_at FROM abandoned_orders WHERE phone=${phone} AND status='converted' ORDER BY created_at LIMIT 1`)[0]?.created_at;
    if (convertedTime) {
      const del = await sql`DELETE FROM abandoned_orders WHERE phone=${phone} AND status='pending' AND created_at < ${convertedTime} RETURNING id`;
      console.log(`deleted ${del.length} old pending for ${phone}`);
    }
  }
}
console.log('done');
