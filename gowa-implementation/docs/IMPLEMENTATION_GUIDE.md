# 🚀 GOWA Implementation Guide

**Status:** Ready for Deployment  
**Target Timeline:** 3-4 weeks  
**Start Date:** 2026-02-27  

---

## 📋 Quick Overview

This guide walks you through setting up GOWA (Go WhatsApp Web Multi-Device) as a replacement for Fonnte.

**Key Points:**
- GOWA runs on your own VPS (self-hosted)
- Uses adapter layer for seamless switching
- Zero downtime migration (run both simultaneously)
- Cost reduction: Rp 500K-2M/month → Rp 25K-200K/month

---

## 🏗️ Architecture

```
┌─────────────────┐
│   WhatsApp      │
│   (Web App)     │
└────────┬────────┘
         │
┌────────▼──────────────┐
│   GOWA Server         │ ← Your VPS (Docker)
│  (Go binary)          │
│  ├─ REST API:3000     │
│  ├─ Dashboard         │
│  └─ Webhooks          │
└────────┬──────────────┘
         │ HTTP/Webhook
         ▼
┌──────────────────────┐
│ digilife-service.js  │ ← Adapter switches between Fonnte/GOWA
│ (Node.js Bot)        │
└──────────────────────┘
```

---

## 📦 Folder Structure

```
gowa-implementation/
├── docker/
│   ├── docker-compose.yml      ← Deploy GOWA + PostgreSQL
│   └── .dockerignore
├── config/
│   ├── .env.example            ← Copy to .env and configure
│   └── gowa.config.json        ← Advanced config (optional)
├── adapter/
│   ├── whatsapp-adapter.js     ← Abstraction layer
│   └── adapter.test.js         ← Unit tests
├── docs/
│   ├── IMPLEMENTATION_STEPS.md  ← Detailed steps
│   ├── MIGRATION_GUIDE.md       ← How to switch
│   └── TROUBLESHOOTING.md       ← Common issues
└── tests/
    ├── test-gowa.js            ← API testing
    └── stress-test.js          ← Load testing
```

---

## 🔧 Phase 1: Setup (Week 1)

### Step 1: Provision VPS
```bash
# Requirements:
CPU:    1vCPU minimum (2vCPU recommended)
RAM:    512MB minimum (1GB recommended)
Storage: 10GB
OS:     Ubuntu 20.04 LTS or newer

# Recommended providers:
# - DigitalOcean    ($5/month, great DX)
# - Linode          ($5/month, reliable)
# - Hetzner Cloud   ($3.5/month, cheap)
# - AWS t3.nano     (~$5/month, scalable)
```

### Step 2: Install Docker
```bash
ssh root@your-vps-ip

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify
docker --version
docker-compose --version
```

### Step 3: Clone & Configure
```bash
# On your VPS
cd /opt

# Clone the gowa-implementation folder
# (Copy the entire gowa-implementation folder to VPS)
scp -r gowa-implementation/ root@your-vps-ip:/opt/gowa

# Enter the directory
cd /opt/gowa

# Create .env file from example
cp config/.env.example config/.env

# Edit .env with your values
nano config/.env
```

### Step 4: Configure Environment Variables
```bash
# config/.env
WHATSAPP_WEBHOOK=http://your-bot-server.com/api/webhook/gowa
WHATSAPP_WEBHOOK_SECRET=generate-random-secret
GOWA_SESSION_ID=default
APP_BASIC_AUTH=admin:change-this-password
```

### Step 5: Deploy GOWA
```bash
# From /opt/gowa directory
docker-compose up -d

# Check logs
docker-compose logs -f gowa

# Verify it's running
curl http://localhost:3001/health

# Or access dashboard (if available)
# http://your-vps-ip:3001/
```

---

## 🔀 Phase 2: Parallel Testing (Week 2)

### Step 1: Update digilife-service.js
```javascript
// At the top of digilife-service.js
const whatsappAdapter = require('./gowa-implementation/adapter/whatsapp-adapter');
whatsappAdapter.initializeAdapter();

// Instead of:
// await axios.post(BOT_API_URL, { to: chatJid, text: responseText });

// Use:
// await whatsappAdapter.sendMessage(chatJid, responseText);
```

### Step 2: Setup Routing (20% GOWA, 80% Fonnte)
```javascript
// In digilife-service.js, after getting response
function getAPIRoute() {
  const random = Math.random();
  
  if (random < 0.2) {  // 20% traffic to GOWA
    return {
      provider: 'gowa',
      send: async (chatId, text) => {
        return await whatsappAdapter.sendMessage(chatId, text);
      }
    };
  } else {  // 80% traffic to Fonnte (current)
    return {
      provider: 'fonnte',
      send: async (chatId, text) => {
        return await axios.post(BOT_API_URL, {
          to: chatId,
          text: responseText,
        });
      }
    };
  }
}

// Usage:
const route = getAPIRoute();
console.log(`📤 Sending via ${route.provider.toUpperCase()}`);
await route.send(chatJid, responseText);
```

### Step 3: Monitor Both
```bash
# Terminal 1: Watch GOWA logs
docker-compose -f gowa-implementation/docker/docker-compose.yml logs -f gowa

# Terminal 2: Watch digilife logs
pm2 logs digilife

# Keep track of success rates:
# - GOWA success rate should be >99%
# - Fonnte success rate (baseline)
# After 24h, compare metrics
```

---

## 🔄 Phase 3: Gradual Migration (Week 3)

### Timeline:
```
Day 1:   10% GOWA, 90% Fonnte  → Monitor
Day 2:   20% GOWA, 80% Fonnte  → Monitor
Day 3:   50% GOWA, 50% Fonnte  → Monitor
Day 4:   80% GOWA, 20% Fonnte  → Monitor
Day 5:   100% GOWA             → Done
```

### Configuration:
```javascript
// Update traffic split based on date
const MIGRATION_CONFIG = {
  startDate: new Date('2026-03-05'),
  schedule: [
    { date: '2026-03-05', gowaPercent: 10 },
    { date: '2026-03-06', gowaPercent: 20 },
    { date: '2026-03-07', gowaPercent: 50 },
    { date: '2026-03-08', gowaPercent: 80 },
    { date: '2026-03-09', gowaPercent: 100 },
  ],
};

function getGowaPercentage() {
  const today = new Date().toISOString().split('T')[0];
  const config = MIGRATION_CONFIG.schedule.find(s => s.date === today);
  return config?.gowaPercent || 100;
}
```

---

## ✅ Phase 4: Validation (Week 4)

### Create Testing Checklist:

**API Tests:**
```javascript
// tests/test-gowa.js
const adapter = require('../adapter/whatsapp-adapter');

async function runTests() {
  console.log('📋 Running GOWA Adapter Tests...\n');
  
  // Test 1: Send text message
  console.log('Test 1: Send text message');
  try {
    const result = await adapter.sendMessage('628xxxxxxxx@c.us', 'Test message');
    console.log('✅ PASS:', result);
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
  
  // Test 2: Check status
  console.log('\nTest 2: Check connection status');
  try {
    const status = await adapter.getStatus();
    console.log('✅ PASS:', status);
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
  
  // Test 3: Switch provider
  console.log('\nTest 3: Switch provider');
  try {
    adapter.switchProvider('gowa');
    const info = adapter.getProviderInfo();
    console.log('✅ PASS:', info);
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
}

runTests().catch(console.error);
```

**Manual Testing:**
- [ ] Send text message to test number
- [ ] Send image with caption
- [ ] Test webhook receiving messages
- [ ] Check message delivery time
- [ ] Verify media downloads work
- [ ] Test with multiple conversations
- [ ] Load test (send 100 messages rapidly)
- [ ] Test after service restart

---

## 🎯 Monitoring & Metrics

### Key Metrics to Track:

**Per-Message Metrics:**
```javascript
const metrics = {
  provider: 'gowa',
  messageLatency: 250,        // ms to send
  deliveryConfirmed: true,
  timestamp: new Date(),
  retries: 0,
};
```

**Daily Report:**
```
📊 GOWA Migration Report - 2026-03-08
├─ Total Messages: 4,567
├─ GOWA Success Rate: 99.8%
├─ Avg Latency: 245ms
├─ Failed Messages: 8
├─ Provider Split: GOWA=80%, Fonnte=20%
└─ Status: ✅ Healthy
```

### Setup Alerting:
```javascript
// Alert if failure rate > 1%
if (failureRate > 0.01) {
  console.error('⚠️  High failure rate detected!');
  // Roll back or investigate
}
```

---

## 🔙 Rollback Plan

If GOWA fails, rollback in seconds:

```javascript
// Quick activation of Fonnte
whatsappAdapter.switchProvider('fonnte');

// Or manual override in env
process.env.WHATSAPP_PROVIDER = 'fonnte';
```

Keep Fonnte active for 1-2 weeks as cold backup.

---

## 📝 Production Checklist

Before full migration, confirm:

- [ ] GOWA deployed on VPS
- [ ] Docker containers healthy
- [ ] Webhook receiving messages
- [ ] PostgreSQL connected
- [ ] Adapter integrated into digilife-service.js
- [ ] 24h parallel testing completed (>99% success)
- [ ] Monitoring/alerts configured
- [ ] Team trained on GOWA ops
- [ ] Rollback plan documented
- [ ] Backup of Fonnte configuration
- [ ] Post-migration support plan

---

## 💰 Cost Savings

**Before Migration (Fonnte):**
```
Monthly: Rp 1.000.000
Yearly:  Rp 12.000.000
5-Year:  Rp 60.000.000
```

**After Migration (GOWA):**
```
VPS Cost:        Rp 100.000/month
Domain:          Rp 50.000/month (optional)
Total Monthly:   Rp 150.000
Yearly:          Rp 1.800.000
5-Year:          Rp 9.000.000

💡 SAVINGS: Rp 51.000.000 over 5 years!
```

---

## 📞 Support Resources

**GOWA Documentation:**
- GitHub: https://github.com/aldinokemal/go-whatsapp-web-multidevice
- Docs: Check README.md

**Troubleshooting Guides:**
- Port conflicts? Change port in docker-compose.yml
- Webhook not working? Check WHATSAPP_WEBHOOK URL
- Auth failures? Verify basic auth credentials
- Database issues? Check PostgreSQL is running

---

## 🎬 Next Steps

1. **This Week:**
   - [ ] Approve implementation plan
   - [ ] Provision VPS (DigitalOcean/Linode)
   - [ ] Deploy GOWA using docker-compose

2. **Next Week:**
   - [ ] Integrate adapter into digilife-service.js
   - [ ] Start 20% traffic to GOWA
   - [ ] Monitor success rates

3. **Week 3:**
   - [ ] Increase to 100% GOWA traffic
   - [ ] Verify metrics

4. **Week 4:**
   - [ ] Cancel Fonnte subscription
   - [ ] Optimize GOWA settings
   - [ ] Setup auto-scaling (optional)

---

**Questions?** Check TROUBLESHOOTING.md or GitHub Discussions.

**Status:** 🟢 Ready to deploy

