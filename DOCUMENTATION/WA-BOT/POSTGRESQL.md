# 🐘 PostgreSQL Integration Guide

Comprehensive guide to conversation history with PostgreSQL.

---

## 📋 Overview

This guide explains the migration from **Google Sheets + NodeCache** to **PostgreSQL** for conversation history storage and retrieval.

**Benefits:**
- ⚡ 10x faster queries (200-400ms vs 2-3s)
- ♾️ Unlimited conversation history
- 💾 Persistent data across service restarts
- 📊 Analytics-ready structured data
- 🔄 Reminder context awareness

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

## �📊 Database Schema

### conversations Table

```sql
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  customer_phone VARCHAR(20) NOT NULL,
  customer_id INTEGER,
  message_text TEXT,
  response_text TEXT,
  intent VARCHAR(50),
  product_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Index for fast lookups
CREATE INDEX idx_conversations_phone ON conversations(customer_phone);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);
```

**Columns:**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | SERIAL | Unique conversation ID |
| `customer_phone` | VARCHAR(20) | Customer phone number |
| `customer_id` | INTEGER | Reference to customer_master |
| `message_text` | TEXT | Customer's message |
| `response_text` | TEXT | Bot's response |
| `intent` | VARCHAR(50) | Classified intent (product_inquiry, renewal, etc.) |
| `product_name` | VARCHAR(100) | Product mentioned (Netflix, Spotify, etc.) |
| `created_at` | TIMESTAMP | When conversation happened |
| `metadata` | JSONB | JSON metadata (confidence, tags, etc.) |

**Metadata Example:**
```json
{
  "intent": "product_inquiry",
  "product": "Netflix",
  "duration": "3 months",
  "confidence": 0.95,
  "intent_detected_at": 1234567890,
  "tags": ["pricing", "popular_product", "promo"],
  "followup_needed": false
}
```

### conversation_metadata Table

```sql
CREATE TABLE conversation_metadata (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  reminder_triggered BOOLEAN DEFAULT FALSE,
  reminder_type VARCHAR(20),        -- h1, h5, h7
  reminder_sent_at TIMESTAMP,
  is_response_to_reminder BOOLEAN DEFAULT FALSE,
  context_tags TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);

-- Index for reminder filtering
CREATE INDEX idx_metadata_reminder ON conversation_metadata(reminder_triggered);
CREATE INDEX idx_metadata_phone ON conversation_metadata(customer_phone);
```

**Columns:**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | SERIAL | Unique metadata ID |
| `conversation_id` | INTEGER | Link to conversation |
| `customer_phone` | VARCHAR(20) | Customer phone |
| `reminder_triggered` | BOOLEAN | Was message triggered by reminder? |
| `reminder_type` | VARCHAR(20) | Type: h1 (1 day), h5 (5 days), h7 (7 days) |
| `reminder_sent_at` | TIMESTAMP | When reminder was sent |
| `is_response_to_reminder` | BOOLEAN | Is this a response to reminder? |
| `context_tags` | TEXT[] | Tags for context analysis |
| `created_at` | TIMESTAMP | When metadata created |

---

## 🔧 Core Functions

All functions are in `digilife-service-pg.js`:

### 1. Get Conversation History

```javascript
async function getConversationHistory(phone, limit = 20) {
  const query = `
    SELECT id, message_text, response_text, intent, product_name, created_at
    FROM conversations
    WHERE customer_phone = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  
  const result = await pool.query(query, [phone, limit]);
  return result.rows.reverse();  // Oldest first
}
```

**Usage:**
```javascript
const history = await getConversationHistory('628128933008', 20);
// Returns: [
//   {
//     id: 1,
//     message_text: 'Halo, harga Netflix brp?',
//     response_text: 'Netflix 3 bulan Rp 99.000',
//     intent: 'product_inquiry',
//     product_name: 'Netflix',
//     created_at: '2026-02-24 10:30:00'
//   },
//   ...
// ]
```

### 2. Update Conversation History

```javascript
async function updateConversationHistory(phone, message, response, metadata = {}) {
  const query = `
    INSERT INTO conversations 
    (customer_phone, message_text, response_text, intent, product_name, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `;
  
  const result = await pool.query(query, [
    phone,
    message,
    response,
    metadata.intent || null,
    metadata.product || null,
    JSON.stringify(metadata)
  ]);
  
  return result.rows[0].id;
}
```

**Usage:**
```javascript
const conversationId = await updateConversationHistory(
  '628128933008',
  'Halo, harga Netflix brp?',
  'Netflix 3 bulan Rp 99.000',
  {
    intent: 'product_inquiry',
    product: 'Netflix',
    duration: '3 months',
    confidence: 0.95,
    tags: ['pricing', 'popular_product']
  }
);
// Returns: conversation ID (1234)
```

### 3. Track Reminder Context

```javascript
async function trackReminderContext(phone, conversationId, reminderType) {
  const query = `
    INSERT INTO conversation_metadata
    (conversation_id, customer_phone, reminder_triggered, reminder_type, reminder_sent_at)
    VALUES ($1, $2, true, $3, NOW())
  `;
  
  await pool.query(query, [conversationId, phone, reminderType]);
}
```

**Usage:**
```javascript
// When H-5 reminder sent
await trackReminderContext('628128933008', 1234, 'h5');
```

### 4. Get Recent Reminder Context

```javascript
async function getRecentReminderContext(phone, hoursAgo = 72) {
  const query = `
    SELECT c.id, c.message_text, c.response_text, cm.reminder_type
    FROM conversations c
    JOIN conversation_metadata cm ON c.id = cm.conversation_id
    WHERE c.customer_phone = $1
    AND cm.reminder_triggered = true
    AND cm.reminder_sent_at > NOW() - INTERVAL '${hoursAgo} hours'
    ORDER BY c.created_at DESC
    LIMIT 5
  `;
  
  const result = await pool.query(query, [phone]);
  return result.rows;
}
```

**Usage:**
```javascript
// Get context when customer responds to reminder
const reminderContext = await getRecentReminderContext('628128933008', 72);
// Bot now knows: "User is responding to a reminder sent 5 days ago"
// Enables contextual response generation
```

### 5. Look up Customer Data

```javascript
async function lookupCustomer(phone) {
  const query = `
    SELECT c.id, c.name, c.phone, c.email, 
           array_agg(
             jsonb_build_object(
               'product_id', cs.product_id,
               'product_name', p.name,
               'duration', cs.duration,
               'amount', cs.amount,
               'start_date', cs.start_date,
               'end_date', cs.end_date,
               'status', cs.status
             )
           ) as subscriptions
    FROM customer_master c
    LEFT JOIN customer_subscriptions cs ON c.id = cs.customer_id
    LEFT JOIN products p ON cs.product_id = p.id
    WHERE c.phone = $1
    GROUP BY c.id, c.name, c.phone, c.email
  `;
  
  const result = await pool.query(query, [phone]);
  return result.rows[0] || null;
}
```

**Returns:**
```javascript
{
  id: 1,
  name: 'Budi Santoso',
  phone: '628128933008',
  email: 'budi@example.com',
  subscriptions: [
    {
      product_id: 1,
      product_name: 'Netflix',
      duration: '3 months',
      amount: 99000,
      start_date: '2026-01-01',
      end_date: '2026-04-01',
      status: 'PAID'
    },
    {
      product_id: 2,
      product_name: 'Spotify',
      duration: '1 month',
      amount: 29000,
      start_date: '2026-02-01',
      end_date: '2026-03-01',
      status: 'ACTIVE'
    }
  ]
}
```

---

## 🔄 Message Processing Flow (PostgreSQL)

### Receiving Message

```
Message arrives: "Halo, berapa harga Netflix?"
↓
wa-bot-1 forwards to /inbound
↓
digilife-ai processes:

1. Load conversation history
   query: SELECT * FROM conversations WHERE customer_phone = '628128933008'
   Result: [Previous 20 conversations]

2. Get reminder context (if customer recently received reminder)
   query: SELECT * FROM conversation_metadata WHERE reminder_triggered = true AND customer_phone = '628128933008'
   Result: None (no recent reminders)

3. Detect intent (GPT)
   Input: [Previous conversations] + Current message
   Output: intent = 'product_inquiry'

4. Extract entities
   Product: Netflix
   Duration: Not specified (assume 3 months default)

5. Search knowledge base
   Look for Netflix pricing info

6. Generate response
   "Netflix 3 bulan Rp 99.000"

7. Save to conversations
   INSERT INTO conversations VALUES (
     '628128933008',
     null,
     'Halo, berapa harga Netflix?',
     'Netflix 3 bulan Rp 99.000',
     'product_inquiry',
     'Netflix',
     NOW(),
     '{"intent": "product_inquiry", "product": "Netflix", ...}'
   )

8. Send to wa-bot-1
   POST /send-message
   Result: Message sent ✅
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

### Step 1: Create Tables

```bash
# Run migration script
node migrate-conversations-table.js

# Output:
# ✅ Connected to PostgreSQL
# ✅ Table conversations created
# ✅ Table conversation_metadata created
# ✅ Indexes created
# ✅ Migration complete
```

### Step 2: Deploy PostgreSQL Service

```bash
# Copy new service
cp digilife-service-pg.js /root/Digilife/

# Stop old service
pm2 stop digilife-ai
pm2 delete digilife-ai

# Start new service
pm2 start digilife-service-pg.js --name "digilife-ai"

# Verify
pm2 logs digilife-ai | grep -i "connected\|postgresql"
```

### Step 3: Verify Data

```bash
# Connect to database
psql -U digilife_user -d digilifedb

# Check records
SELECT COUNT(*) FROM conversations;
SELECT COUNT(*) FROM conversation_metadata;

# View sample conversation
SELECT * FROM conversations LIMIT 1;
```

---

## 🔍 Querying Examples

### Get all conversations for a customer

```sql
SELECT customer_phone, message_text, response_text, intent, created_at
FROM conversations
WHERE customer_phone = '628128933008'
ORDER BY created_at DESC;
```

### Get conversations with specific intent

```sql
SELECT * FROM conversations
WHERE intent = 'product_inquiry'
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Get reminder-triggered conversations

```sql
SELECT c.customer_phone, c.message_text, cm.reminder_type, cm.reminder_sent_at
FROM conversations c
JOIN conversation_metadata cm ON c.id = cm.conversation_id
WHERE cm.reminder_triggered = true
AND cm.reminder_sent_at > NOW() - INTERVAL '24 hours';
```

### Analytics: Product popularity

```sql
SELECT product_name, COUNT(*) as inquiry_count
FROM conversations
WHERE intent = 'product_inquiry'
AND created_at > NOW() - INTERVAL '30 days'
GROUP BY product_name
ORDER BY inquiry_count DESC;
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

- [Architecture](./ARCHITECTURE.md) - System design
- [Deployment](./DEPLOYMENT.md) - How to deploy
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues

---

**Created:** 2026-02-24  
**Version:** 2.1  
**Level:** Advanced
