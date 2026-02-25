# 🏗️ WA Bot Architecture

Detailed system design, data flow, and component interaction.

---

## 📐 System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────┐
│        WhatsApp Network                     │
│        (External)                           │
└────────────────────┬────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────┐
│   EDGE LAYER                                │
│  ┌─────────────────────────────────────┐   │
│  │  wa-bot-1 (Port 3010)               │   │
│  │  • Baileys WhatsApp Socket          │   │
│  │  • Receive messages                 │   │
│  │  • Forward to digilife              │   │
│  └─────────────────────────────────────┘   │
└────────────────────┬────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────┐
│   AI ENGINE LAYER                           │
│  ┌─────────────────────────────────────┐   │
│  │  digilife-ai (Port 3005)            │   │
│  │  • Intent detection                 │   │
│  │  • Response generation              │   │
│  │  • Data processing                  │   │
│  └─────────────────────────────────────┘   │
│              ↓   ↓   ↓                      │
│    ┌────────┴──┬──┴────────┐       ┌──────┐│
│    ↓          ↓      ↓     ↓       ↓      ││
│  ┌───────┐ ┌──────┐ ┌──────┐ ┌─────────┐││
│  │ GPT   │ │Qdrant│ │Postgres│Nginx 3001│
│  │-4o    │ │6333  │ │5432    │Port      ││
│  │mini   │ │      │ │        │routing   ││
│  └───────┘ └──────┘ └──────┘ └─────────┘││
└─────────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────┐
│   DATA LAYER                                │
│  ┌─────────────────────────────────────┐   │
│  │  PostgreSQL (Port 5432)             │   │
│  │  • customer_master                  │   │
│  │  • customer_subscriptions           │   │
│  │  • conversations (NEW)              │   │
│  │  • conversation_metadata (NEW)      │   │
│  │  • groups                           │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  Qdrant Vector DB (Port 6333)       │   │
│  │  • Knowledge base                   │   │
│  │  • Semantic search                  │   │
│  │  • Product info embeddings          │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

---

## 🔄 Message Processing Flow

### 1. **Receive Phase**
```javascript
WhatsApp
  ↓
wa-bot-1 reads socket
  ↓
Parse message
  ├→ Extract: phone, text, mediaUrl
  ├→ Download image (if media)
  └→ Send to /inbound endpoint
```

### 2. **Process Phase**
```javascript
digilife-ai /inbound
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
Save to PostgreSQL:
  ├→ conversations table
  │   ├→ customer_phone
  │   ├→ message_text
  │   ├→ response_text
  │   ├→ intent
  │   └→ metadata
  │
  └→ conversation_metadata table
      ├→ reminder_triggered (if applicable)
      ├→ reminder_type (h1/h5/h7)
      └→ context_tags
```

### 4. **Send Phase**
```javascript
Forward to wa-bot-1
  ↓
wa-bot-1 /send-message
  ↓
Call Baileys sendMessage
  ↓
Message sent to WhatsApp
```

---

## 🗄️ Data Models

### Conversations Table
```sql
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  customer_phone VARCHAR(20),
  customer_id INTEGER,
  message_text TEXT,
  response_text TEXT,
  intent VARCHAR(50),
  product_name VARCHAR(100),
  created_at TIMESTAMP,
  metadata JSONB
);
```

**Metadata Example:**
```json
{
  "intent": "product_inquiry",
  "product": "Netflix",
  "duration": "3 months",
  "confidence": 0.92,
  "intent_detected_at": 1234567890,
  "tags": ["pricing", "popular_product"]
}
```

### Conversation Metadata Table
```sql
CREATE TABLE conversation_metadata (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER,
  customer_phone VARCHAR(20),
  reminder_triggered BOOLEAN,
  reminder_type VARCHAR(20),    -- h1, h5, h7
  reminder_sent_at TIMESTAMP,
  is_response_to_reminder BOOLEAN,
  context_tags TEXT[]
);
```

---

## 🔗 Service Interactions

### wa-bot-1 ↔ Nginx ↔ digilife-ai

```
Direct Connection (recommended):
wa-bot-1 (3010)
  → POST http://localhost:3005/inbound
  → digilife-ai (3005)
  → Success! ✅

Via Nginx (optional, for future scalability):
wa-bot-1 (3010)
  → POST http://localhost:3001/inbound
  → Nginx reverse proxy
  → Routes to http://localhost:3005
  → digilife-ai (3005)
```

### Port Mapping
```
External        → Internal       → Service
3010  (IPv4)    → 3010 (IPv6)    → wa-bot-1 socket
3005  (IPv6)    → localhost:3005 → digilife-ai
3001  (IPv4)    → localhost:3005 → Nginx proxy
3015  (IPv6)    → localhost:3015 → reminder-service
5432  (IPv4/6)  → localhost:5432 → PostgreSQL
6333  (IPv4/6)  → localhost:6333 → Qdrant
```

---

## 📊 Conversation Flow Example

### Scenario: Customer asks about Netflix pricing

```
1. RECEIVE
   Customer: "Halo, berapa harga Netflix 3 bulan?"
   wa-bot-1: Receives message, forwards to /inbound

2. PROCESS
   digilife-ai:
   ├─ Load history: 5 previous messages from customer
   ├─ Intent: PRODUCT_INQUIRY
   ├─ Product recognized: Netflix
   ├─ Duration: 3 months
   ├─ Search Qdrant: Find Netflix pricing info
   ├─ Generate response: "Netflix 3 bulan Rp 99.000"

3. SAVE
   PostgreSQL conversations:
   {
     customer_phone: '628128933008',
     message_text: 'Halo, berapa harga Netflix 3 bulan?',
     response_text: 'Netflix 3 bulan Rp 99.000',
     intent: 'product_inquiry',
     product_name: 'Netflix',
     metadata: {
       intent: 'product_inquiry',
       product: 'Netflix',
       duration: '3 months',
       confidence: 0.95,
       tags: ['pricing', 'product_info']
     }
   }

4. SEND
   wa-bot-1: Send response via WhatsApp
   Customer: Receives "Netflix 3 bulan Rp 99.000"
```

---

## 🔄 Reminder System Flow

### Scheduled Reminders (reminder-service)

```
Cron Job (Daily)
  ↓
├─ H-7: Clear PAID status (7:01 WIB)
├─ H-5: Send renewal reminder (16:30 WIB)
└─ H-1: Last chance reminder (10:00 WIB)
  ↓
For each customer with expiring subscription:
  ├─ Generate reminder message
  ├─ Save to conversations (type: SYSTEM_REMINDER)
  ├─ Track in conversation_metadata (reminder_triggered: true)
  └─ Send via wa-bot-1

When customer responds:
  ├─ Fetch reminder context from DB
  ├─ Add to message context
  ├─ GPT understands: "User is responding to reminder"
  └─ Generate contextual response
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

- [VPS Deployment](./VPS_DEPLOYMENT.md) - How to deploy
- [PostgreSQL Integration](./POSTGRESQL_INTEGRATION.md) - Database details
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues

---

**Created:** 2026-02-24  
**Level:** Intermediate
