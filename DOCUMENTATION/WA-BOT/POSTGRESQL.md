# 🐘 PostgreSQL Guide

Database schema, queries, and function reference for the Digilife WA Bot.

---

## 📋 Overview

Semua data operasional bot sudah 100% dari PostgreSQL (migrasi dari Google Sheets selesai Feb 2026).

**Data yang ada di PostgreSQL:**
- ✅ `customer_subscriptions` — 531 rows, sumber utama customer data
- ✅ `customer_master` — 300 unique customers
- ✅ `pricing` — 45 items produk aktif
- ✅ `groups` — 197 group credentials
- ✅ `conversations` — persistent chat history

**Benefits atas Google Sheets:**
- ⚡ 10x faster queries (50-100ms vs 2-3s)
- ♾️ Unlimited conversation history
- 💾 Persistent data across service restarts
- No Google Sheets API rate limits

---

## � Database Connection

### Production (VPS Remote)

| Parameter | Value |
|-----------|-------|
| Host | `145.79.10.104` |
| Port | `5432` |
| Database | `digilifedb` |
| User | `digilife_user` |
| Password | `MasyaAllah26` |

**Connection String (DATABASE_URL):**
```
postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb
```

**Node.js Pool Config:**
```javascript
const pool = new Pool({
  host: '145.79.10.104',
  port: 5432,
  database: 'digilifedb',
  user: 'digilife_user',
  password: 'MasyaAllah26',
});
```

> ⚠️ Di `.env` gunakan `DATABASE_URL=postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb`  
> Saat deploy di VPS, gunakan `host: localhost` (koneksi lokal lebih cepat dan aman).

---

## 🗄️ Database Schema

### customer_subscriptions (Primary Source)

Tabel FLAT — satu baris per subscription. Tidak normalized ke `customer_master`.

```sql
SELECT id, nama, wa_pelanggan, produk, subscription,
       end_membership, start_membership, status_payment,
       slot, email, profil_pin,
       reminded_h5_at, reminded_h1_at, customer_id
FROM customer_subscriptions;
```

| Column | Type | Notes |
|--------|------|-------|
| `nama` | VARCHAR | Nama pelanggan |
| `wa_pelanggan` | VARCHAR | Nomor WA (628xxx) |
| `produk` | VARCHAR | Nama produk (Netflix, dll) |
| `subscription` | VARCHAR | Tipe subscription |
| `end_membership` | DATE | Tanggal berakhir |
| `start_membership` | DATE | Tanggal mulai |
| `status_payment` | VARCHAR | `PAID`, `FREE`, dll |
| `slot` | VARCHAR | Nomor slot |
| `email` | VARCHAR | Email account |
| `profil_pin` | VARCHAR | PIN profil |
| `reminded_h5_at` | TIMESTAMP | Timestamp kirim H-5 reminder |
| `reminded_h1_at` | TIMESTAMP | Timestamp kirim H-1 reminder |
| `customer_id` | INTEGER | FK ke customer_master (opsional) |

> ⚠️ `status_payment = 'FREE'` = family/internal owner, **jangan kirim reminder**.

### customer_master

300 rows unique customers. `nama` memiliki UNIQUE CONSTRAINT.

```sql
SELECT id, nama, wa_pelanggan, email, city, customer_type
FROM customer_master;
```

### pricing

45 rows aktif. Primary source untuk info harga produk.

```sql
SELECT product, duration, price, description, category
FROM pricing
WHERE is_active = true;
```

### groups

197 rows. Kolom utama adalah `subscription` (bukan `name`).

```sql
SELECT subscription, email, password, code, link, max_slots
FROM groups;
```

### conversations

Simple persistent history. Satu row per exchange (message + response).

```sql
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  customer_phone VARCHAR(20) NOT NULL,
  message_text TEXT,
  response_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_phone ON conversations(customer_phone);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);
```

---

## 🔧 Core Functions (`digilife-service.js`)

### 1. Lookup Customer Name by Phone

```javascript
async function lookupCustomerName(phone) {
  const result = await pgPool.query(`
    SELECT nama FROM customer_master WHERE wa_pelanggan = $1
    UNION
    SELECT nama FROM customer_subscriptions WHERE wa_pelanggan = $1
    LIMIT 1
  `, [phone]);
  return result.rows[0]?.nama || null;
}
```

**Usage:**
```javascript
const nama = await lookupCustomerName('628128933008');
// Returns: 'Budi Santoso' or null (jika nomor tidak terdaftar)
```

### 2. Get Conversation History

```javascript
async function getConversationHistoryPG(phone) {
  const result = await pgPool.query(
    `SELECT message_text, response_text, created_at
     FROM conversations
     WHERE customer_phone = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [phone]
  );
  return result.rows.reverse(); // oldest first
}
```

### 3. Save Conversation

```javascript
async function saveConversationPG(phone, message, response) {
  await pgPool.query(
    `INSERT INTO conversations (customer_phone, message_text, response_text)
     VALUES ($1, $2, $3)`,
    [phone, message, response]
  );
}
```

### 4. Load Pricing Data

```javascript
async function loadPricingData() {
  const result = await pgPool.query(
    `SELECT product, duration, price
     FROM pricing
     WHERE is_active = true
     ORDER BY product, price`
  );
  return result.rows;
  // Returns 45 items: [{product:'Netflix', duration:'1 Bulan', price:45000}, ...]
}
```

### 5. Load Customer Data

```javascript
async function loadCustomerData() {
  const result = await pgPool.query(
    `SELECT id AS customer_id, nama, wa_pelanggan, produk, subscription,
            end_membership, start_membership, status_payment,
            slot, email, profil_pin
     FROM customer_subscriptions
     ORDER BY nama`
  );
  return result.rows;
  // Returns 531 rows
}
```

### 6. Load Group Data

```javascript
async function loadGroupData() {
  const result = await pgPool.query(
    `SELECT subscription AS name, email, password, code
     FROM groups
     WHERE active = true`
  );
  return result.rows;
}
```

### 7. Payment Update

```javascript
// When customer confirms payment
await pgPool.query(
  `UPDATE customer_subscriptions
   SET end_membership = $1, status_payment = 'PAID'
   WHERE wa_pelanggan = $2 AND produk = $3`,
  [newEndDate, phone, product]
);
```

---

## 🔄 Message Processing Flow

```
Message arrives: "Halo, berapa harga Netflix?"
↓
fonnte-bot POST /webhook → digilife POST /inbound
↓
1. lookupCustomerName(phone) → nama = 'Budi Santoso'
2. getConversationHistoryPG(phone) → last 20 exchanges
3. loadPricingData() (cached, pre-loaded at startup)
4. GPT generates response with ka *Budi* greeting
5. saveConversationPG(phone, message, response)
6. Return response → fonnte-bot → Fonnte API → WhatsApp
```

---

## 📈 Performance Comparison

### Google Sheets + NodeCache (OLD)

| Operation | Time | Limitation |
|-----------|------|-----------|
| Customer lookup | 2-3s | API rate limit |
| Pricing lookup | 2-3s | API rate limit |
| History retrieval | <100ms | Max 10 messages, 30-min TTL |
| Total per message | 4-6s | Loss on restart |

### PostgreSQL (NEW)

| Operation | Time | Benefit |
|-----------|------|---------|
| Customer lookup | 50-100ms | No rate limit |
| Pricing lookup | 50-100ms | No rate limit |
| History retrieval | <50ms | Unlimited messages |
| Total per message | 100-400ms | Persistent data |

**⚡ Overall: 10x faster, ♾️ unlimited history**

---

## 🚀 Migration Steps

> ✅ **Migration sudah selesai.** Semua data sudah di PostgreSQL sejak Feb 2026.
> Bagian ini hanya sebagai referensi historis.

---

## 🔍 Query Reference

### Check subscription status

```sql
SELECT nama, wa_pelanggan, produk, end_membership, status_payment
FROM customer_subscriptions
WHERE wa_pelanggan = '628128933008';
```

### Subscriptions expiring in N days (reminder query)

```sql
SELECT id, nama, wa_pelanggan, produk, end_membership, status_payment,
       slot, reminded_h5_at, reminded_h1_at
FROM customer_subscriptions
WHERE DATE(end_membership) = CURRENT_DATE + INTERVAL '5 days'
  AND UPPER(COALESCE(status_payment,'')) != 'FREE'
ORDER BY nama;
```

### Conversation history for a customer

```sql
SELECT customer_phone, message_text, response_text, created_at
FROM conversations
WHERE customer_phone = '628128933008'
ORDER BY created_at DESC
LIMIT 20;
```

### Pricing for a specific product

```sql
SELECT product, duration, price
FROM pricing
WHERE LOWER(product) LIKE '%netflix%'
  AND is_active = true
ORDER BY price;
```

### Group credentials for a subscription type

```sql
SELECT subscription, email, password, code, link
FROM groups
WHERE subscription ILIKE '%netflix%'
LIMIT 5;
```

### Analytics: Most active customers

```sql
SELECT customer_phone, COUNT(*) as exchanges
FROM conversations
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY customer_phone
ORDER BY exchanges DESC
LIMIT 10;
```

---

## 🔐 Backup & Recovery

### Daily Backup

```bash
# Add to crontab
0 2 * * * /usr/bin/pg_dump -U digilife_user digilifedb | gzip > /backups/digilifedb_$(date +\%Y\%m\%d).sql.gz

# Run manually
pg_dump -U digilife_user digilifedb | gzip > digilifedb_backup.sql.gz
```

### Restore from Backup

```bash
# Restore
gunzip -c digilifedb_backup.sql.gz | psql -U digilife_user digilifedb
```

---

## 📖 Related Guides

- [Deployment Guide](./DEPLOYMENT.md) - How to deploy
- [Architecture](./ARCHITECTURE.md) - System design

---

**Last Updated:** 2026-02-25  
**Status:** ✅ Production active, 100% PostgreSQL  
**Level:** Advanced
