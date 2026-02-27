# 🚀 GOWA Implementation Package

**Status:** Ready for Deployment  
**Version:** 1.0.0  
**Created:** 2026-02-27  

---

## 📌 Quick Start

Transform your WhatsApp bot from **Fonnte** (Rp 500K-2M/month) to **GOWA** (FREE/self-hosted, ~Rp 150K/month VPS):

```bash
# 1. Deploy GOWA server
cd docker/
docker-compose up -d

# 2. Configure adapter
cp config/.env.example config/.env
# Edit config/.env with your settings

# 3. Integrate into digilife-service.js
# See docs/IMPLEMENTATION_GUIDE.md for details

# 4. Run tests
node tests/gowa-adapter.test.js
```

**Timeline:** 3-4 weeks (Week 1: Test, Week 2-3: Migrate, Week 4: Optimize)

---

## 📂 Folder Structure

```
gowa-implementation/
│
├── 📁 docker/
│   └── docker-compose.yml          ← Deploy GOWA + PostgreSQL in Docker
│
├── 📁 config/
│   └── .env.example                ← All configuration variables (copy to .env)
│
├── 📁 adapter/
│   └── whatsapp-adapter.js         ← Abstraction layer (Fonnte ↔ GOWA switching)
│
├── 📁 docs/
│   ├── IMPLEMENTATION_GUIDE.md      ← Step-by-step deployment guide ⭐
│   └── (More docs coming)
│
├── 📁 tests/
│   └── gowa-adapter.test.js        ← Test suite for adapter
│
└── README.md                        ← This file
```

---

## 🎯 What is GOWA?

**GOWA** = **Go WhatsApp Web Multi-Device**

A self-hosted WhatsApp server written in **Go** that:
- ✅ Runs on your own VPS (no external subscription)
- ✅ Costs ~Rp 150K/month (vs Rp 500K-2M for Fonnte)
- ✅ Uses 3x less memory (60-100MB vs 200-300MB)
- ✅ Supports multi-device WhatsApp seamlessly
- ✅ Integrates with AI agents via MCP
- ✅ Stores sessions in PostgreSQL (your database)

**GitHub:** https://github.com/aldinokemal/go-whatsapp-web-multidevice  
**License:** MIT (Free to use)

---

## 🏗️ Architecture

### Current Setup (Fonnte):
```
WhatsApp Web → Fonnte API (external) → digilife-service.js (your bot)
                  ↓ (monthly cost: Rp 500K-2M)
```

### New Setup (GOWA):
```
WhatsApp Web → GOWA Server (your VPS, Docker) → digilife-service.js (your bot)
                  ↓ (monthly cost: ~Rp 150K for VPS)
```

### Switching Layer:
```
digilife-service.js
        ↓
whatsapp-adapter.js (decides which API to use)
        ↓
   ┌────┴────┐
   ↓         ↓
Fonnte   GOWA API
(old)    (new)
```

**Zero-downtime migration** ✅ Run both simultaneously, gradually shift traffic

---

## 📋 Files Overview

### 1️⃣ **docker-compose.yml**
Contains complete Docker setup for GOWA + PostgreSQL.

**What it does:**
- Starts GOWA server on port `3001`
- Starts PostgreSQL for session storage
- Configures webhooks to send messages to your bot
- Sets up health checks and auto-restart

**Usage:**
```bash
cd docker/
docker-compose up -d          # Start services
docker-compose logs -f gowa   # Watch logs
docker-compose down           # Stop services
```

---

### 2️⃣ **.env.example**
Configuration template with all variables needed for GOWA.

**Key variables:**
```bash
GOWA_PORT=3001                        # GOWA server port
DATABASE_URL=postgresql://...         # PostgreSQL connection
WEBHOOK_URL=http://your-bot/webhook   # Where GOWA sends messages
WEBHOOK_SECRET=random-secret-key      # HMAC signature verification
APP_BASIC_AUTH=admin:password         # GOWA dashboard auth
AUTO_MARK_READ=true                   # Auto-mark messages as read
AUTO_DOWNLOAD_MEDIA=true              # Auto-download images/videos
```

**Usage:**
```bash
cp config/.env.example config/.env
nano config/.env  # Edit with your values
```

---

### 3️⃣ **whatsapp-adapter.js**
Abstraction layer enabling seamless provider switching.

**What it does:**
- Provides single interface for both Fonnte and GOWA
- Routes messages to correct provider
- Handles authentication for both APIs
- Manages failover and error handling

**Key methods:**
```javascript
const adapter = require('./adapter/whatsapp-adapter');

// Send message (works with any provider)
await adapter.sendMessage(phoneNumber, text);

// Send image
await adapter.sendImage(phoneNumber, imageUrl, caption);

// Switch provider at runtime (no restart!)
adapter.switchProvider('gowa');     // Switch to GOWA
adapter.switchProvider('fonnte');   // Switch back to Fonnte

// Check which provider is active
const info = adapter.getProviderInfo();
console.log(info.provider); // 'gowa' or 'fontte'
```

**Integration in digilife-service.js:**
```javascript
// Replace:
// await axios.post(BOT_API_URL, { to: chatJid, text: responseText });

// With:
// await whatsappAdapter.sendMessage(chatJid, responseText);
```

---

### 4️⃣ **IMPLEMENTATION_GUIDE.md**
Complete step-by-step guide for deployment.

**Sections:**
1. **Setup (Week 1):** Provision VPS, install Docker, deploy GOWA
2. **Testing (Week 2):** Parallel testing with 20% traffic to GOWA
3. **Migration (Week 3):** Gradually increase traffic (50% → 100%)
4. **Production (Week 4):** Full switch, cancellation, optimization

**Must-read checklist:**
- [ ] Read IMPLEMENTATION_GUIDE.md fully
- [ ] Decide on VPS provider (DigitalOcean recommended)
- [ ] Follow Week 1 steps
- [ ] Run gowa-adapter.test.js
- [ ] Proceed with parallel testing

---

### 5️⃣ **gowa-adapter.test.js**
Comprehensive test suite for the adapter layer.

**Test suites:**
1. **Initialization:** Adapter starts correctly
2. **Message Sending:** Send text/images work
3. **Provider-Specific:** Auth for Fonnte & GOWA
4. **Error Handling:** Network errors handled gracefully
5. **Performance:** Speed & memory usage

**Run tests:**
```bash
node tests/gowa-adapter.test.js
```

**Expected output:**
```
TESTS PASSED: 15/15 (100%)
```

---

## 🚀 Getting Started (5 Steps)

### Step 1: Read the Guide
```bash
# Open and read fully
docs/IMPLEMENTATION_GUIDE.md
```

### Step 2: Provision VPS
```
Recommended: DigitalOcean $5/month
- Ubuntu 22.04
- 1GB RAM
- 1vCPU
- 10GB SSD
```

### Step 3: Deploy GOWA
```bash
ssh root@your-vps-ip
cd /opt/gowa/docker
docker-compose up -d
```

### Step 4: Configure
```bash
cp config/.env.example config/.env
# Edit config/.env with your values
```

### Step 5: Test & Integrate
```bash
# Run tests
node tests/gowa-adapter.test.js

# Integrate into digilife-service.js
# See IMPLEMENTATION_GUIDE.md for code changes
```

---

## 💰 Cost Analysis

### Fonnte (Current)
```
Monthly:  Rp 500K - Rp 2M
Yearly:   Rp 6M - Rp 24M
5-Year:   Rp 30M - Rp 120M
```

### GOWA (New)
```
VPS:      Rp 100K/month (DigitalOcean $5)
Domain:   Rp 50K/month (optional)
Database: Already included
Total:    Rp 150K/month (~Rp 2K/message at 1K msgs/day)

Yearly:   Rp 1.8M
5-Year:   Rp 9M

💡 SAVINGS: Rp 21M - Rp 111M over 5 years!
```

---

## ⚙️ Configuration

### Minimal Setup:
```bash
# config/.env
GOWA_PORT=3001
WEBHOOK_URL=http://your-bot-server:3005/api/webhook/gowa
WEBHOOK_SECRET=any-random-secret-key
APP_BASIC_AUTH=admin:changeme
```

### Full Setup:
```bash
# See config/.env.example for all 30+ variables
```

---

## 🔀 Migration Strategy

### Week 1: Testing
- Deploy GOWA on separate VPS
- 20% traffic to GOWA, 80% to Fonnte
- Monitor success rates (target: >99%)

### Week 2-3: Gradual Migration
- Day 1: 10% GOWA
- Day 2: 20% GOWA
- Day 3: 50% GOWA
- Day 4: 80% GOWA
- Day 5: 100% GOWA

### Week 4: Optimization
- Monitor performance
- Setup auto-scaling (optional)
- Cancel Fonnte subscription
- Document GOWA operations

---

## 📊 Monitoring

Track these metrics during migration:

```
📈 Daily Report:
├─ Total Messages: 1,234
├─ GOWA Success Rate: 99.8%
├─ Avg Latency: 245ms
├─ Failed Messages: 2
└─ Status: ✅ Healthy
```

**Tools:**
- PM2 logs for digilife-service.js
- Docker logs for GOWA (`docker-compose logs gowa`)
- Custom metrics in adapter (latency, success rate)

---

## 🔙 Rollback Plan

If GOWA fails, switch back instantly:

```javascript
// In digilife-service.js
whatsappAdapter.switchProvider('fonnte');
```

Keep Fonnte active for 2 weeks as fallback.

---

## 🆘 Troubleshooting

### GOWA not starting?
```bash
docker-compose logs gowa
# Check port conflicts, disk space, memory
```

### Webhook not receiving messages?
```bash
# Verify webhook URL in .env
# Check firewall allows port 3005
# Verify HMAC secret matches
```

### Performance issues?
```bash
# Monitor VPS resources
free -h
docker stats

# Increase VPS size if needed
```

**Full troubleshooting:**  
See docs/ folder for detailed guides

---

## 📚 Resources

### GOWA
- **GitHub:** https://github.com/aldinokemal/go-whatsapp-web-multidevice
- **Docs:** Check repository README.md
- **Issues:** Report on GitHub

### WhatsApp Adapter
- **File:** adapter/whatsapp-adapter.js
- **Tests:** tests/gowa-adapter.test.js

### Your Bot
- **Service:** digilife-service.js
- **Integration:** See IMPLEMENTATION_GUIDE.md

---

## ✅ Deployment Checklist

Before production, verify:

- [ ] Read IMPLEMENTATION_GUIDE.md completely
- [ ] Provision VPS (DigitalOcean recommended)
- [ ] Deploy GOWA with docker-compose
- [ ] Configure .env with your settings
- [ ] Run gowa-adapter.test.js (all tests pass)
- [ ] Integrate adapter into digilife-service.js
- [ ] Test 20% traffic to GOWA for 24h
- [ ] Monitor success rates (>99%)
- [ ] Gradually increase traffic
- [ ] Document any custom configuration
- [ ] Setup monitoring/alerting
- [ ] Plan rollback procedure
- [ ] Brief team on GOWA operations

---

## 🎬 Next Steps

1. **Now:** Read IMPLEMENTATION_GUIDE.md
2. **This Week:** Provision VPS & deploy GOWA
3. **Next Week:** Start parallel testing (20% traffic)
4. **Week 3:** Gradual migration (50% → 100%)
5. **Week 4:** Full production switch

---

## 📞 Support

**Questions?**
- Check IMPLEMENTATION_GUIDE.md
- Review gowa-adapter.test.js for examples
- Check GOWA GitHub repository

**Ready to deploy?**
```bash
docker-compose up -d
```

**Status:** 🟢 Production-ready  
**Last Updated:** 2026-02-27

---

**Made with ❤️ for MarkPlus Indonesia**

*Your WhatsApp bot, faster and cheaper.*

