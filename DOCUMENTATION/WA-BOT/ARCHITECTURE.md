# 🏗️ WA Bot Architecture

Detailed system design, data flow, and component interaction.

---

## 📐 System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────┐
│     WhatsApp Network (Fonnte Cloud)     │
└───────────────────┬─────────────────────┘
                    │
                    ↓ POST /webhook
┌─────────────────────────────────────────┐
│   GATEWAY LAYER                         │
│    fonnte-bot (Port 3010)               │
│    • Fonnte webhook receiver            │
│    • POST /webhook → /inbound           │
│    • POST /send-message → Fonnte API    │
└───────────────────┬─────────────────────┘
                    │
                    ↓ POST /inbound
┌─────────────────────────────────────────┐
│   AI ENGINE LAYER                       │
│    digilife (Port 3005)                 │
│    • lookupCustomerName()               │
│    • Intent detection (GPT-4o-mini)     │
│    • Pricing / customer lookup          │
│    • Conversation history (PostgreSQL)  │
└──────────────┬────────────┬────────────┘
               │            │
        GPT-4o-mini      Qdrant:6333
               │
┌──────────────┴──────────────────────────┐
│   DATA LAYER  PostgreSQL:5432           │
│   • customer_subscriptions (531 rows)   │
│   • customer_master (300 rows)          │
│   • pricing (45 items)                  │
│   • groups (197 rows)                   │
│   • conversations (chat history)        │
└─────────────────────────────────────────┘
```

---

## 🔄 Message Processing Flow

### 1. **Receive Phase**
```javascript
WhatsApp message arrives at Fonnte
  ↓
Fonnte sends POST /webhook → fonnte-bot:3010
  ↓
Parse webhook payload
  ├→ Extract: sender (phone), message text
  └→ Forward POST /inbound → digilife:3005
```

### 2. **Process Phase**
```javascript
digilife /inbound
  ↓
Load conversation history (PostgreSQL)
  ↓
Detect reminder context
  ↓
Detect intent (GPT classification)
  ├→ Product inquiry?
  ├→ Renewal?
  ├→ Support?
  └→ General greeting?
  ↓
Search vector DB for relevant info
  ↓
Generate response (GPT-4o-mini)
  ↓
Compose final message
```

### 3. **Save Phase**
```javascript
Save to PostgreSQL conversations table:
  ├→ customer_phone
  ├→ message_text
  └→ response_text
```

### 4. **Send Phase**
```javascript
digilife sends POST /send-message → fonnte-bot:3010
  ↓
fonnte-bot calls Fonnte API
  ↓
Fonnte delivers via WhatsApp
```

---

## 🗄️ Data Models

### PostgreSQL Tables

| Table | Rows | Purpose |
|-------|------|---------|
| `customer_subscriptions` | 531 | Main data source — FLAT, satu row per subscription |
| `customer_master` | 300 | Unique customers by `nama` |
| `pricing` | 45 | Product pricing (is_active = true) |
| `groups` | 197 | Group credentials per subscription type |
| `conversations` | growing | Persistent chat history per customer |

### customer_subscriptions (Primary Source)

```sql
SELECT id, nama, wa_pelanggan, produk, subscription,
       end_membership, start_membership, status_payment,
       slot, email, profil_pin,
       reminded_h5_at, reminded_h1_at, customer_id
FROM customer_subscriptions;
```

> ⚠️ Tabel ini FLAT, bukan normalized. Satu customer bisa punya banyak baris.
> `status_payment = 'FREE'` = family/internal owner — skip reminder.

### conversations

```sql
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  customer_phone VARCHAR(20) NOT NULL,
  message_text TEXT,
  response_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔗 Service Interactions

### Request Flow

```
Fonnte Cloud
  → POST /webhook  →  fonnte-bot:3010
  → POST /inbound  →  digilife:3005
  ← response       ←  digilife:3005
  ← POST /send-message  ←  digilife to fonnte-bot:3010
  → Fonnte API     →  WhatsApp
```

### Port Mapping
```
Service         Port    PM2 ID  Script
fonnte-bot      3010    26      /root/digilife-bot/fonnte-bot.js
digilife        3005    19      /root/Digilife/digilife-service.js
reminder        3015    20      /root/Digilife/reminder-service.js
PostgreSQL      5432    —       system service
Qdrant          6333    —       system service
```

---

## 📊 Conversation Flow Example

### Scenario: Customer asks about Netflix pricing

```
1. RECEIVE
   Customer WA: "Halo, berapa harga Netflix 3 bulan?"
   Fonnte → POST /webhook → fonnte-bot:3010
   fonnte-bot → POST /inbound → digilife:3005

2. PROCESS
   digilife:
   ├─ lookupCustomerName(phone) → nama = 'Budi Santoso'
   ├─ getConversationHistoryPG(phone) → last 20 messages
   ├─ Intent detection → PRODUCT_INQUIRY, produk: Netflix
   ├─ Search Qdrant → pricing info
   ├─ loadPricingData() → Netflix price from DB
   └─ GPT generates: "Punteun ka *Budi*, Netflix 3 bulan Rp 99.000"

3. SAVE
   saveConversationPG(phone, message, response)
   INSERT INTO conversations (customer_phone, message_text, response_text)

4. SEND
   digilife → POST /send-message → fonnte-bot:3010
   fonnte-bot → Fonnte API → WhatsApp delivery
   Customer receives: "Punteun ka *Budi*, Netflix 3 bulan Rp 99.000"
```

---

## 🔄 Reminder System Flow

### Scheduled Reminders (reminder)

```
Cron Job (Daily, WIB timezone)
  │
  ├─ H-7 reset (7:01): UPDATE reminded_h5_at = NULL WHERE end_membership = 7 days AND status = PAID
  ├─ H-5 remind (16:30): Send if end_membership = 5 days, reminded_h5_at IS NULL
  └─ H-1 remind (10:00): Send if end_membership = 1 day, reminded_h1_at IS NULL

Query filter:
  WHERE DATE(end_membership) = CURRENT_DATE + INTERVAL 'N days'
  AND UPPER(COALESCE(status_payment,'')) != 'FREE'

For each expiring subscription:
  ├─ Read: nama, wa_pelanggan, produk, subscription, slot, end_membership
  ├─ Format reminder message with ka *{nama}* greeting
  ├─ Send via fonnte-bot POST /send-message
  └─ UPDATE reminded_h5_at / reminded_h1_at = NOW()
```

---

## 📈 Performance Metrics

### Before PostgreSQL (Google Sheets)
- Customer lookup: 2-3 seconds
- Pricing lookup: 2-3 seconds
- Conversation history: Max 10 messages

### After PostgreSQL
- Customer lookup: 50-100 milliseconds ⚡
- Pricing lookup: 50-100 milliseconds ⚡
- Conversation history: Unlimited ♾️

**Overall improvement: 10x faster message processing**

---

## 📖 Learn More

- [Deployment Guide](./DEPLOYMENT.md) - How to deploy & maintain
- [PostgreSQL Guide](./POSTGRESQL.md) - Database schema & queries

---

**Last Updated:** 2026-02-25  
**Level:** Intermediate
