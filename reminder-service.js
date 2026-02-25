// Auto Reminder Service for Subscription Expiry (PostgreSQL Version)
// H-7: Clear PAID status + reset reminded flags
// H-5: First reminder at 16:30 WIB
// H-1: Final reminder at 10:00 WIB

const cron = require('node-cron');
const { Pool } = require('pg');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// â”€â”€â”€ Database Connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb',
});

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3010/send-message';

// â”€â”€â”€ Init: add missing columns if not exist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function initDB() {
  const migrations = [
    `ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS slot VARCHAR(20)`,
    `ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS subscription_name VARCHAR(150)`,
    `ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS reminded_h5_at TIMESTAMP`,
    `ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS reminded_h1_at TIMESTAMP`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch (e) { /* column may already exist */ }
  }
  console.log('âœ… DB schema checked');
}

// â”€â”€â”€ Product type detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FAMILY_ACCOUNT_KEYWORDS = ['YOUTUBE', 'SPOTIFY', 'CANVA', 'MICROSOFT', 'APPLE MUSIC'];

function isFamily(produk) {
  const p = (produk || '').toUpperCase();
  return FAMILY_ACCOUNT_KEYWORDS.some(k => p.includes(k));
}

// â”€â”€â”€ Date formatting (to Indonesian) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatDate(date) {
  const d = new Date(date);
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// â”€â”€â”€ Load customers expiring in N days from PostgreSQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadExpiringCustomers(daysTarget) {
  try {
    const result = await pool.query(
      `SELECT
        cm.id    AS customer_id,
        cm.nama,
        cm.wa_number,
        cs.id    AS sub_id,
        cs.produk,
        cs.end_date,
        cs.status,
        cs.slot,
        cs.subscription_name,
        cs.reminded_h5_at,
        cs.reminded_h1_at,
        g.name   AS group_name,
        g.email  AS group_email,
        g.code   AS group_code
       FROM customer_subscriptions cs
       JOIN customer_master cm ON cs.customer_id = cm.id
       LEFT JOIN groups g      ON UPPER(g.name) = UPPER(cs.produk)
       WHERE cs.active = true
         AND DATE(cs.end_date) = CURRENT_DATE + INTERVAL '${daysTarget} days'
       ORDER BY cm.nama`
    );
    console.log(`   ðŸ“‹ Found ${result.rows.length} subscribers expiring in ${daysTarget} day(s)`);
    return result.rows;
  } catch (error) {
    console.error('âŒ Error loading customers:', error.message);
    return [];
  }
}

// â”€â”€â”€ Generate reminder message with nama greeting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateMessage(customer, daysLeft) {
  const nama         = customer.nama  || 'kak';
  const produk       = customer.produk || 'subscription';
  const slotInfo     = customer.slot  ? ` (Slot ${customer.slot})` : '';
  const familyAcct   = isFamily(produk);
  const emailInfo    = familyAcct && customer.group_email ? ` yg akun _${customer.group_email}_` : '';
  const formattedDate = formatDate(customer.end_date);

  if (daysLeft === 5) {
    return (
      `Punteun ka *${nama}*,\n` +
      `mau reminder utk subscription *${produk}*${emailInfo} akan expire di tanggal *${formattedDate}*${slotInfo} ya ka..ðŸ™ðŸ»`
    );
  }

  if (daysLeft === 1) {
    return (
      `Punteun ka *${nama}*,\n` +
      `mau reminder kembali utk subscription *${produk}*${emailInfo} akan expire *besok*${slotInfo} ya ka..ðŸ™ðŸ»\n` +
      `Mohon Konfirmasi nya apakah akan di perpanjang kembali ?`
    );
  }

  return null;
}

// â”€â”€â”€ Send via Fonnte gateway â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendWhatsAppMessage(phone, message) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  try {
    await axios.post(BOT_API_URL, { to: cleanPhone, text: message }, { timeout: 10000 });
    console.log(`   âœ… Sent to ${cleanPhone}`);
    return true;
  } catch (error) {
    console.error(`   âŒ Failed to send to ${cleanPhone}:`, error.message);
    return false;
  }
}

// â”€â”€â”€ Mark reminder as sent in PostgreSQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function markReminded(subId, daysTarget) {
  const col = daysTarget === 5 ? 'reminded_h5_at' : 'reminded_h1_at';
  await pool.query(
    `UPDATE customer_subscriptions SET ${col} = NOW() WHERE id = $1`,
    [subId]
  );
}

// â”€â”€â”€ H-7: Clear PAID status + reset reminder flags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function clearPaidExpiring() {
  try {
    const result = await pool.query(
      `UPDATE customer_subscriptions
          SET status = NULL,
              reminded_h5_at = NULL,
              reminded_h1_at = NULL
        WHERE active = true
          AND DATE(end_date) = CURRENT_DATE + INTERVAL '7 days'
          AND UPPER(status) = 'PAID'
       RETURNING id`
    );
    console.log(`   ðŸ—‘ï¸  Cleared PAID status for ${result.rowCount} subscription(s)`);
    return result.rowCount;
  } catch (error) {
    console.error('âŒ Error clearing PAID status:', error.message);
    return 0;
  }
}

// â”€â”€â”€ Main reminder check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function checkAndSendReminders(daysTarget) {
  const label = daysTarget === 7 ? 'H-7 Clear' : daysTarget === 5 ? 'H-5' : 'H-1';
  console.log(`\nðŸ”” Running ${label} check...`);

  if (daysTarget === 7) {
    const cleared = await clearPaidExpiring();
    console.log(`âœ… H-7 Complete: ${cleared} subscription(s) cleared`);
    return;
  }

  const customers = await loadExpiringCustomers(daysTarget);
  let sent = 0;

  for (const c of customers) {
    if (!c.wa_number) {
      console.log(`   âš ï¸  Skip ${c.nama} - no WhatsApp number`);
      continue;
    }

    const alreadyReminded = daysTarget === 5 ? c.reminded_h5_at : c.reminded_h1_at;
    if (alreadyReminded) {
      console.log(`   â­ï¸  Skip ${c.nama} - already reminded`);
      continue;
    }

    const message = generateMessage(c, daysTarget);
    if (!message) continue;

    const ok = await sendWhatsAppMessage(c.wa_number, message);
    if (ok) {
      await markReminded(c.sub_id, daysTarget);
      sent++;
    }

    // Avoid rate limiting â€” small delay between messages
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`âœ… ${label} Complete: sent ${sent}/${customers.length} reminder(s)`);
}

// â”€â”€â”€ Express API for manual triggers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const app = express();
app.use(express.json());

app.post('/trigger-reminder', async (req, res) => {
  try {
    const type = (req.body && req.body.type) || req.query.type;
    const typeMap = { h7: 7, h5: 5, h1: 1 };

    if (!type || !typeMap[type]) {
      return res.status(400).json({ error: 'Invalid type. Use: h1, h5, or h7' });
    }

    console.log(`\nðŸ”” Manual trigger: ${type.toUpperCase()} reminder...`);
    await checkAndSendReminders(typeMap[type]);

    res.json({ success: true, message: `${type.toUpperCase()} reminder triggered` });
  } catch (error) {
    console.error('âŒ Manual trigger error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'reminder-service', source: 'postgresql' });
});

// â”€â”€â”€ Startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.REMINDER_PORT || 3015;

app.listen(PORT, async () => {
  console.log('\nðŸš€ Auto-Reminder Service (PostgreSQL) Starting...');
  console.log(`ðŸ“¡ API running on port ${PORT}`);
  console.log('   POST /trigger-reminder {"type": "h1"} â†’ Trigger H-1 now');
  console.log('   POST /trigger-reminder {"type": "h5"} â†’ Trigger H-5 now');
  console.log('   POST /trigger-reminder {"type": "h7"} â†’ Trigger H-7 clear now\n');

  await initDB();

  console.log('\nðŸ“… Cron Schedule (WIB):');
  console.log('   07:01 WIB â€” H-7: Clear PAID status');
  console.log('   16:30 WIB â€” H-5: First reminder');
  console.log('   10:00 WIB â€” H-1: Final reminder');
  console.log('\nâœ… Ready â€” waiting for scheduled tasks...\n');
});

// â”€â”€â”€ Cron jobs (UTC = WIB - 7) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// H-7: Clear PAID at 07:01 WIB â†’ 00:01 UTC
cron.schedule('1 0 * * *', () => checkAndSendReminders(7));

// H-5: Send reminder at 16:30 WIB â†’ 09:30 UTC
cron.schedule('30 9 * * *', () => checkAndSendReminders(5));

// H-1: Send reminder at 10:00 WIB â†’ 03:00 UTC
cron.schedule('0 3 * * *', () => checkAndSendReminders(1));

// Keep alive
process.on('SIGINT', () => {
  console.log('\nðŸ‘‹ Shutting down...');
  pool.end();
  process.exit(0);
});
