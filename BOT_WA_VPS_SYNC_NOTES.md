# Bot WA Agent - VPS Configuration & Sync Status
**Last Updated:** February 24, 2026 | **Status:** ⚠️ GAPS IDENTIFIED

---

## 📍 VPS Architecture

### Service Locations
| Service | Location | Port | Status | PID |
|---------|----------|------|--------|-----|
| **Bot Baileys** | `/root/Baileys/bot-1/server.js` | **3010** | ✅ Running | 2676040 |
| **Digilife AI** | `/root/Digilife/digilife-service.js` | **3001** | ✅ Running | 2446371 |
| **Reminder Service** | `/root/Digilife/reminder-service.js` | **3015** | ✅ Running | 2674207 |
| **Dashboard API** | `/var/www/m-dp/dist/index.cjs` | ? | ✅ Running | 2457719 |

### Port Listening Status (Feb 24, 00:23)
```
tcp   0.0.0.0:3001    LISTEN  (Digilife)
tcp6  :::3005         LISTEN  (Unknown - possible issue!)
tcp6  :::3010         LISTEN  (Bot)
tcp6  :::3015         LISTEN  (Reminder)
```

---

## ⚠️ CRITICAL GAPS IDENTIFIED

### GAP #1: Port Mismatch - Bot to Digilife 🔴
**Issue:** Bot sends messages to wrong port!

```javascript
// VPS: /root/Baileys/bot-1/server.js (Line ~15)
const digiLifeServiceUrl = 'http://localhost:3005/inbound';
                                          ^^^^
                                    WRONG PORT!
```

**Problem:**
- Bot forwards incoming messages to port **3005**
- But Digilife service listens on port **3001**
- **Result:** Messages may not reach Digilife service!

**Fix Required:**
```javascript
// Should be:
const digiLifeServiceUrl = 'http://localhost:3001/inbound';
```

---

### GAP #2: Port Mismatch - Digilife to Bot 🔴
**Issue:** Digilife expects bot on wrong port!

```javascript
// VPS: /root/Digilife/digilife-service.js (Line ~17)
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3000/send-message';
                                                                         ^^^^
                                                                   WRONG PORT!
```

**Problem:**
- Digilife tries to send responses to bot on port **3000**
- But Bot listens on port **3010**
- **Result:** Bot cannot receive responses from Digilife!

**Fix Required:**
```javascript
// Should be:
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3010/send-message';
```

---

### GAP #3: .env Missing in Bot Directory ⚠️
```bash
# VPS check result:
root@srv805012:~/Baileys/bot-1# cat .env
# Output: No .env file found!
```

**Current State:**
- Bot hardcodes port 3010 ✅
- Bot hardcodes digiLifeServiceUrl to 3005 ❌

**Recommendation:**
- Add `.env` support so port config is externalized
- Use environment variables: `BOT_PORT`, `DIGILIFE_URL`

---

## ✅ What's Working

1. **Bot connects to WhatsApp** - Running normally, receiving messages ✅
2. **Digilife AI responds** - User received response from DigiLife service ✅
3. **Port 3010 listening** - Bot port accessible ✅
4. **Reminder service** - Running on port 3015 ✅
5. **Conversation history** - NodeCache with 30-min TTL, last 10 messages ✅

---

## 📝 Local vs VPS Sync Status

### Bot Files
| File | Local Path | VPS Path | Last Modified | Status |
|------|-----------|----------|----------------|--------|
| **bot-1-server.js** | `\Automation\Ai Agent\bot-1-server.js` | `/root/Baileys/bot-1/server.js` | Feb 21, 19:23 | ⏳ Synced (but ports wrong) |
| **digilife-service.js** | `\Automation\Ai Agent\digilife-service.js` | `/root/Digilife/digilife-service.js` | Feb 22, 08:15 | ⏳ Synced (but ports wrong) |
| **reminder-service.js** | `\Automation\Ai Agent\reminder-service.js` | `/root/Digilife/reminder-service.js` | Feb 22, 07:34 | ✅ Synced |

### .env Status
| Location | Content | Status |
|----------|---------|--------|
| Local | `C:\Users\hp\...\Ai Agent\.env` | Has `BOT_API_URL=http://localhost:3000/send-message` | ❌ Wrong port (3000) |
| VPS `/root/Digilife/` | Present | Has `BOT_API_URL` line | ❌ Wrong port |
| VPS `/root/Baileys/bot-1/` | **MISSING** | No .env file | ⚠️ Not synced |

---

## 🔧 How It Works (Current)

```
WhatsApp → Bot (3010) → Digilife (3005?) → OpenAI → Response
                ↓
           Port 3005 forward
           (But service on 3001!)
```

### The Flow (What Should Happen)
1. User sends message to WhatsApp
2. Bot (port 3010) receives & downloads media if needed
3. Bot forwards to Digilife (should be 3001, not 3005)
4. Digilife processes + calls OpenAI
5. Digilife sends response back to Bot (should call 3010, not 3000)
6. Bot forwards text to WhatsApp

---

## 🎯 Implementation Checklist

### Immediate Fixes Needed (LOCAL)
- [ ] Update `bot-1-server.js` line 15: Change port 3005 → 3001
- [ ] Update `digilife-service.js` line 17: Change port 3000 → 3010
- [ ] Update `.env` in local: Change `BOT_API_URL` to port 3010
- [ ] Add `.env.example` for bot-1 directory with port configs
- [ ] Test locally with `npm run dev`

### VPS Deployment
- [ ] Upload fixed `bot-1-server.js` to `/root/Baileys/bot-1/`
- [ ] Upload fixed `digilife-service.js` to `/root/Digilife/`
- [ ] Create `.env` in `/root/Baileys/bot-1/` with:
  ```
  PORT=3010
  DIGILIFE_URL=http://localhost:3001/inbound
  ```
- [ ] Restart bot services:
  ```bash
  pm2 stop bot-1
  pm2 stop digilife-service
  pm2 start bot-1
  pm2 start digilife-service
  ```
- [ ] Verify with: `curl http://localhost:3010/send-message` (should get error, but prove port is listening)
- [ ] Test message flow end-to-end

---

## 💬 Conversation History Implementation

**Status:** ✅ ALREADY IMPLEMENTED

### Storage
- **Type:** NodeCache (in-memory)
- **TTL:** 30 minutes (auto-expire)
- **Capacity:** Last 10 messages per user
- **Used for:** Context-aware AI responses

### Location
```javascript
// File: digilife-service.js (Lines 65-66)
const conversationCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });
const MAX_HISTORY = 10; // Simpan last 10 messages per user
```

### Functions
```javascript
getConversationHistory(phoneNumber)    // Retrieve history
updateConversationHistory(phoneNumber, role, content)  // Add message
```

### Limitation
- **Not persistent:** History lost on service restart
- **Recommend:** Add PostgreSQL logging for analytics

---

## 🚀 Recent Bot Activity

**Last Known Status:** Feb 24, 00:18 (Bot started/restarted)
```
User: "pagi ka mau tanya boleh?"
Bot:  "Selamat pagi, Haryadi! Tentu, silakan tanyakan..."
```

**Indicates:**
- ✅ Bot receiving messages correctly
- ✅ Digilife AI processing correctly
- ✅ Response generation working
- ⚠️ But port config gaps may cause issues with media/images

---

## 📞 Contact & References

**Bot Config Files:**
- Main Bot: `/root/Baileys/bot-1/server.js`
- AI Service: `/root/Digilife/digilife-service.js`
- Reminders: `/root/Digilife/reminder-service.js`

**Local Development:**
- All files in: `C:\Users\hp\OneDrive - MarkPlus Indonesia ,PT\MARKPLUS\Automation\Ai Agent\`

**VPS Address:** `root@145.79.10.104`
**VPS Ports:** 3001 (AI), 3010 (Bot), 3015 (Reminder)

---

**Last Verified:** Feb 24, 2026  
**Next Review:** After port fixes + restart  
**Owner:** Haryadi (Suharyadi)
