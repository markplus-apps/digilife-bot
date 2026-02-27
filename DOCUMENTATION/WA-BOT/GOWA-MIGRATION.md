# 🔀 GOWA Migration Guide

Panduan lengkap untuk migrasi dari **Fonnte** (commercial API) ke **GOWA** (self-hosted WhatsApp server).

---

## ✅ Implementation Status

> **Last updated:** June 2025 — Adapter fully integrated into production codebase.

| Task | Status | Notes |
|------|--------|-------|
| GOWA implementation package | ✅ Done | `gowa-implementation/` folder |
| `whatsapp-adapter.js` | ✅ Fixed | Uses `localhost:3010` gateway (Fonnte) |
| `docker-compose.yml` | ✅ Updated | 1 VPS config, `host.docker.internal` |
| Adapter import + `sendWAMessage` helper | ✅ Done | `digilife-service.js` lines 15-35 |
| All 10 send calls replaced | ✅ Done | `axios.post(BOT_API_URL)` → `sendWAMessage()` |
| `/api/webhook/gowa` endpoint | ✅ Done | Receives GOWA messages |
| `/api/admin/switch-provider` | ✅ Done | Runtime switch, no restart |
| `/api/admin/provider-status` | ✅ Done | Check current provider |
| Deploy GOWA on VPS | ⏳ Pending | Next step: run docker-compose on VPS |
| Connect WhatsApp number | ⏳ Pending | Scan QR at `http://VPS_IP:3001` |
| Switch traffic to GOWA | ⏳ Pending | After testing succeeds |

### Cara Switch Provider (sudah bisa dipakai sekarang)

**Via .env** (requires pm2 restart):
```bash
# Di VPS: /root/Digilife/.env
WHATSAPP_PROVIDER=gowa   # atau 'fonnte'
pm2 restart digilife
```

**Via API** (zero downtime, no restart):
```bash
curl -X POST http://localhost:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "gowa", "adminPassword": "YOUR_ADMIN_PASSWORD"}'
```

**Check status:**
```bash
curl http://localhost:3005/api/admin/provider-status
```

---

## 📋 Overview

**What is GOWA?**
- **GOWA** = Go WhatsApp Web Multi-Device
- Self-hosted WhatsApp server written in Go
- Open source, MIT license
- GitHub: https://github.com/aldinokemal/go-whatsapp-web-multidevice

**Why Migrate?**
- 💰 **Cost Savings:** Rp 500K-2M/month → ~Rp 150K/month (VPS only)
- ⚡ **Performance:** 3x lower memory usage (60-100MB vs 200-300MB)
- 🚀 **Features:** Native multi-device, MCP support, PostgreSQL integration
- 🔒 **Control:** Full ownership, no vendor lock-in

**Migration Timeline:** 4 weeks
- Week 1: Testing (20% traffic)
- Week 2-3: Gradual migration (50% → 100%)
- Week 4: Production optimization

---

## 📊 Fonnte vs GOWA Comparison

| Aspect | Fonnte (Current) | GOWA (New) |
|--------|-----------------|------------|
| **Type** | Commercial API | Self-hosted |
| **Cost** | Rp 500K-2M/month | ~Rp 150K/month (VPS) |
| **Memory** | 200-300MB/device | 60-100MB/device |
| **Multi-Device** | Limited | Native support |
| **Setup** | Instant | ~30 minutes |
| **Control** | Vendor-dependent | Full control |
| **Database** | N/A | PostgreSQL native |
| **AI Integration** | No | MCP support (Cursor/Claude) |
| **Language** | N/A (API only) | Go (ultra-efficient) |
| **Watermark** | Removed (paid plan) | None |

**5-Year Cost Comparison:**
```
Fonnte:  Rp 60M  (Rp 1M/month average)
GOWA:    Rp 9M   (Rp 150K/month VPS)
Savings: Rp 51M  (85% reduction!)
```

---

## 🏗️ Architecture Overview

### Current Architecture (Fonnte)

```
┌────────────────┐
│  WhatsApp Web  │
└───────┬────────┘
        │
        ↓ (Fonnte cloud handles this)
┌─────────────────────────┐
│  Fonnte API (External)  │
│  api.fonnte.com         │
│  • Paid subscription    │
│  • Limited control      │
└───────┬─────────────────┘
        │
        ↓ POST /send-message
┌──────────────────────────┐
│  digilife-service.js     │
│  (Your VPS)              │
└──────────────────────────┘
```

### New Architecture (GOWA)

```
┌────────────────┐
│  WhatsApp Web  │
└───────┬────────┘
        │
        ↓ (GOWA handles this on your VPS)
┌─────────────────────────┐
│  GOWA Server (Docker)   │
│  Your VPS:3001          │
│  • Self-hosted          │
│  • Full control         │
│  • PostgreSQL session   │
└───────┬─────────────────┘
        │
        ↓ Webhook → /api/webhook/gowa
┌──────────────────────────┐
│  digilife-service.js     │
│  (Your VPS:3005)         │
│                          │
│  ├─ whatsapp-adapter.js  │  ← ABSTRACTION LAYER
│  │   (switch Fonnte/GOWA)│
│  │                       │
│  └─ Seamless switching   │
└──────────────────────────┘
```

**Key Change:**
- WhatsApp connection moves from Fonnte cloud → **Your VPS**
- Same bot code, just different provider via adapter

---

## 📦 GOWA Implementation Package

All files sudah disiapkan di `/gowa-implementation/`:

```
gowa-implementation/
├── README.md                       ← Overview & quick start
├── DEPLOYMENT_CHECKLIST.md         ← Step-by-step checklist
│
├── docker/
│   └── docker-compose.yml          ← GOWA + PostgreSQL setup
│
├── config/
│   └── .env.example                ← Configuration template
│
├── adapter/
│   └── whatsapp-adapter.js         ← Abstraction layer (Fonnte ↔ GOWA)
│
├── docs/
│   ├── IMPLEMENTATION_GUIDE.md      ← Week-by-week deployment
│   └── MIGRATION_INTEGRATION_STEPS.md  ← Code integration guide
│
└── tests/
    └── gowa-adapter.test.js        ← Test suite
```

---

## 🎯 Migration Phases

### **Phase 1: Setup & Testing (Week 1)**

#### Step 1.1: Provision VPS for GOWA

**Requirements:**
- CPU: 1 vCPU (2 vCPU recommended)
- RAM: 1GB minimum (2GB recommended)
- Storage: 10GB
- OS: Ubuntu 20.04+ LTS

**Recommended Providers:**
- DigitalOcean ($5/month)
- Linode ($5/month)
- Hetzner ($3.5/month)

**Setup:**
```bash
# SSH to new VPS
ssh root@your-gowa-vps-ip

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

#### Step 1.2: Deploy GOWA

```bash
# Copy gowa-implementation folder to VPS
scp -r gowa-implementation/ root@your-gowa-vps-ip:/opt/gowa/

# SSH to VPS
ssh root@your-gowa-vps-ip

# Navigate to folder
cd /opt/gowa/docker

# Create .env from example
cp ../config/.env.example ../config/.env

# Edit configuration
nano ../config/.env
```

**Configure `.env`:**
```bash
# GOWA Configuration
GOWA_PORT=3001
APP_BASIC_AUTH=admin:your-secure-password

# Webhook to digilife service
WHATSAPP_WEBHOOK=http://145.79.10.104:3005/api/webhook/gowa
WHATSAPP_WEBHOOK_SECRET=generate-random-secret-here

# PostgreSQL (for GOWA session storage)
POSTGRES_USER=gowa_user
POSTGRES_PASSWORD=secure-password
POSTGRES_DB=gowa_db

# Auto-features
AUTO_MARK_READ=true
AUTO_DOWNLOAD_MEDIA=true
AUTO_REJECT_CALLS=true
```

**Deploy:**
```bash
# Start services
docker-compose up -d

# Check logs
docker-compose logs -f gowa

# Wait for "Listening on port 3001"
# Visit http://your-gowa-vps-ip:3001 to scan QR code
```

#### Step 1.3: Integrate Adapter into digilife-service.js ✅ DONE

**File:** `digilife-service.js`

> **Status: ALREADY IMPLEMENTED.** Code changes below are for reference only.

**Import + initialization (lines 15-35):**
```javascript
// WhatsApp Provider Adapter (supports Fonnte via local gateway AND GOWA)
const waAdapter = require('./gowa-implementation/adapter/whatsapp-adapter');

// Initialize WhatsApp adapter singleton
waAdapter.initializeAdapter();

async function sendWAMessage(chatId, text) {
  return await waAdapter.sendMessage(chatId, text);
}
```

**All 10 send calls replaced (OLD → NEW):**
```javascript
// OLD (Direct Fonnte gateway call - was used in 10 places)
await axios.post(BOT_API_URL, { to: chatJid, text: responseText });

// NEW (Via adapter - single line, works for both providers)
await sendWAMessage(chatJid, responseText);
```

**3 new endpoints added (before app.listen):**
- `POST /api/webhook/gowa` → receives GOWA format, transforms to `/inbound`
- `POST /api/admin/switch-provider` → switch Fonnte ↔ GOWA at runtime
- `GET /api/admin/provider-status` → check current active provider

**Deploy to production:**
```bash
# From local
git add .
git commit -m "feat: integrate GOWA adapter with provider switching

- Add WhatsAppAdapter abstraction layer (gowa-implementation/adapter/)
- Replace all 10 direct axios.post(BOT_API_URL) with sendWAMessage()
- Add /api/webhook/gowa endpoint for GOWA message receiving
- Add /api/admin/switch-provider for zero-downtime provider switching
- Add /api/admin/provider-status for monitoring
- Update docker-compose.yml for 1 VPS (host.docker.internal)"
git push

# Deploy to VPS
ssh root@145.79.10.104 "cd /root/Digilife && git pull && pm2 restart digilife"
```

#### Step 1.4: Test with 20% Traffic

**Update message handler:**
```javascript
// In digilife-service.js, message handler section
async function sendWhatsAppMessage(chatJid, messageText) {
  // Route 20% to GOWA, 80% to Fonnte
  const random = Math.random();
  
  if (random < 0.2) {
    whatsappAdapter.switchProvider('gowa');
    console.log('🧪 TEST: Routing to GOWA (20%)');
  } else {
    whatsappAdapter.switchProvider('fonnte');
    console.log('📡 Production: Routing to Fonnte (80%)');
  }
  
  try {
    const result = await whatsappAdapter.sendMessage(chatJid, messageText);
    console.log(`✅ Sent via ${result.provider}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed with ${whatsappAdapter.getProviderInfo().provider}:`, error.message);
    throw error;
  }
}
```

**Monitor:**
```bash
# Terminal 1: GOWA logs
ssh root@your-gowa-vps-ip
docker-compose -f /opt/gowa/docker/docker-compose.yml logs -f gowa

# Terminal 2: digilife logs
ssh root@145.79.10.104
pm2 logs digilife

# Watch success rates
```

**Metrics to track:**
- GOWA success rate (target: >99%)
- Fonnte success rate (baseline)
- Average latency (GOWA should be similar or faster)
- Error types

---

### **Phase 2: Gradual Migration (Week 2-3)**

#### Week 2: Increase to 50%

```javascript
// Update traffic split
if (random < 0.5) {  // 50% GOWA
  whatsappAdapter.switchProvider('gowa');
} else {  // 50% Fonnte
  whatsappAdapter.switchProvider('fonnte');
}
```

**Monitor for 3-5 days:**
- Both providers stable?
- No customer complaints?
- Error rates acceptable?

#### Week 3: Increase to 80%

```javascript
if (random < 0.8) {  // 80% GOWA
  whatsappAdapter.switchProvider('gowa');
} else {  // 20% Fonnte (backup)
  whatsappAdapter.switchProvider('fonnte');
}
```

**Monitor for 3-5 days:**
- GOWA handling majority traffic well?
- Performance metrics stable?

---

### **Phase 3: Full Production (Week 4)**

#### Switch to 100% GOWA

```javascript
// Remove random routing
whatsappAdapter.switchProvider('gowa');
console.log('📡 Production: Using GOWA (100%)');
```

**Update `.env`:**
```bash
WA_PROVIDER=gowa
```

**Deploy:**
```bash
git add .
git commit -m "feat: switch to 100% GOWA provider"
git push
ssh root@145.79.10.104 "cd /root/Digilife && git pull && pm2 restart digilife"
```

**Monitor 48 hours:**
- All messages sending?
- No errors in logs?
- Customer satisfaction maintained?

#### Cancel Fonnte Subscription

**After 2 weeks of stability:**
1. Document Fonnte configuration (backup)
2. Export any Fonnte-specific data
3. Cancel subscription via Fonnte dashboard
4. Remove Fonnte credentials from `.env`

**Archive Fonnte config:**
```bash
# Create backup
cat /root/Digilife/.env | grep FON > /root/backups/fonnte-config-backup.txt
```

---

## 🔄 Provider Switching Commands

### Manual Switch via API

```bash
# Check current provider
curl http://145.79.10.104:3005/api/admin/provider-status

# Switch to GOWA
curl -X POST http://145.79.10.104:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "gowa"}'

# Switch to Fonnte (rollback)
curl -X POST http://145.79.10.104:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "fonnte"}'
```

### Switch via Code

```javascript
// In digilife-service.js or via Node REPL
whatsappAdapter.switchProvider('gowa');
console.log(whatsappAdapter.getProviderInfo());
```

---

## 📊 Monitoring & Metrics

### Add Metrics Tracking

```javascript
// At top of digilife-service.js
const providerMetrics = {
  fonnte: { sent: 0, errors: 0 },
  gowa: { sent: 0, errors: 0 },
};

// In sendWhatsAppMessage function
async function sendWhatsAppMessage(chatJid, messageText) {
  const provider = whatsappAdapter.getProviderInfo().provider;
  
  try {
    const result = await whatsappAdapter.sendMessage(chatJid, messageText);
    providerMetrics[provider].sent++;
    return result;
  } catch (error) {
    providerMetrics[provider].errors++;
    throw error;
  }
}

// Add metrics endpoint
app.get('/api/admin/metrics', (req, res) => {
  const fonteSuccessRate = providerMetrics.fonnte.sent / (providerMetrics.fonnte.sent + providerMetrics.fonnte.errors) * 100;
  const gowaSuccessRate = providerMetrics.gowa.sent / (providerMetrics.gowa.sent + providerMetrics.gowa.errors) * 100;
  
  res.json({
    fonnte: {
      ...providerMetrics.fonnte,
      successRate: fonteSuccessRate.toFixed(2) + '%'
    },
    gowa: {
      ...providerMetrics.gowa,
      successRate: gowaSuccessRate.toFixed(2) + '%'
    },
    currentProvider: whatsappAdapter.getProviderInfo()
  });
});
```

### Check Metrics

```bash
# View metrics
curl http://145.79.10.104:3005/api/admin/metrics | jq

# Expected output:
{
  "fontte": {
    "sent": 450,
    "errors": 2,
    "successRate": "99.56%"
  },
  "gowa": {
    "sent": 120,
    "errors": 0,
    "successRate": "100.00%"
  },
  "currentProvider": {
    "provider": "gowa",
    "status": "ready"
  }
}
```

---

## 🔙 Rollback Procedures

### Scenario 1: GOWA Performance Issues

```bash
# Immediate switch back to Fonnte
curl -X POST http://145.79.10.104:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "fonnte"}'

# Verify
curl http://145.79.10.104:3005/api/admin/provider-status
```

### Scenario 2: GOWA Server Crash

```bash
# GOWA down, switch to Fonnte
ssh root@145.79.10.104
cd /root/Digilife

# Update code to force Fonnte
echo "WA_PROVIDER=fonnte" >> .env

# Restart
pm2 restart digilife

# Check logs
pm2 logs digilife
```

**Fix GOWA:**
```bash
ssh root@your-gowa-vps-ip
cd /opt/gowa/docker

# Check logs
docker-compose logs gowa

# Restart
docker-compose restart gowa

# Or full rebuild
docker-compose down
docker-compose up -d
```

### Scenario 3: Complete Rollback

```bash
# Revert code changes
git checkout v1.1.0  # Version before GOWA

# Restart
pm2 restart digilife

# Keep GOWA running (for future retry)
```

---

## 🎯 Success Criteria

**Phase 1 (Week 1) - PASS if:**
- [ ] GOWA deployed successfully
- [ ] Adapter integrated into digilife-service.js
- [ ] 20% traffic to GOWA with >99% success rate
- [ ] No increase in customer complaints
- [ ] Logs clean (no critical errors)

**Phase 2 (Week 2-3) - PASS if:**
- [ ] 50% traffic stable for 3+ days
- [ ] 80% traffic stable for 3+ days
- [ ] Success rates maintained (>99%)
- [ ] Response times acceptable
- [ ] No customer impact

**Phase 3 (Week 4) - PASS if:**
- [ ] 100% GOWA traffic for 2+ weeks
- [ ] Zero critical errors
- [ ] Customer satisfaction maintained
- [ ] Cost savings realized
- [ ] Documentation complete

---

## 💰 Cost Savings Realized

**Before (Fonnte):**
```
Monthly:    Rp 1.000.000
Yearly:     Rp 12.000.000
5-Year:     Rp 60.000.000
```

**After (GOWA):**
```
VPS (GOWA):     Rp 100.000/month
VPS (Main):     Rp 0 (already have)
Domain (opt):   Rp 50.000/month
----------------------------------------
Monthly Total:  Rp 150.000
Yearly:         Rp 1.800.000
5-Year:         Rp 9.000.000

💡 SAVINGS: Rp 51.000.000 over 5 years!
```

---

## 📝 Migration Checklist

### Pre-Migration
- [ ] Read IMPLEMENTATION_GUIDE.md fully
- [ ] Provision GOWA VPS
- [ ] Deploy GOWA with docker-compose
- [ ] Test GOWA connection (scan QR)
- [ ] Integrate adapter into digilife-service.js
- [ ] Deploy adapter to production
- [ ] Configure webhook GOWA → digilife

### Week 1 (Testing)
- [ ] Start 20% traffic to GOWA
- [ ] Monitor success rates daily
- [ ] Check GOWA logs for errors
- [ ] Verify webhook functioning
- [ ] Track metrics (sent/errors)
- [ ] No customer impact

### Week 2-3 (Gradual Migration)
- [ ] Increase to 50% traffic
- [ ] Monitor 3-5 days
- [ ] Increase to 80% traffic
- [ ] Monitor 3-5 days
- [ ] Verify performance metrics
- [ ] Document any issues

### Week 4 (Full Production)
- [ ] Switch to 100% GOWA
- [ ] Monitor 48 hours intensively
- [ ] Verify all features working
- [ ] Check customer satisfaction
- [ ] Wait 2 weeks for stability
- [ ] Cancel Fonnte subscription
- [ ] Archive Fonnte configuration
- [ ] Update documentation

---

## 🔗 Related Documentation

- **Git Workflow**: [GIT-WORKFLOW.md](GIT-WORKFLOW.md) - Development & deployment process
- **GOWA Package**: `/gowa-implementation/README.md` - Quick start guide
- **Implementation Guide**: `/gowa-implementation/docs/IMPLEMENTATION_GUIDE.md` - Detailed steps
- **Code Integration**: `/gowa-implementation/docs/MIGRATION_INTEGRATION_STEPS.md` - Code changes
- **Deployment Checklist**: `/gowa-implementation/DEPLOYMENT_CHECKLIST.md` - Step-by-step
- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md) - System design

---

## 📞 Support

**GOWA Issues:**
- GitHub: https://github.com/aldinokemal/go-whatsapp-web-multidevice/issues
- Check logs: `docker-compose logs gowa`

**Adapter Issues:**
- Test suite: `node gowa-implementation/tests/gowa-adapter.test.js`
- Check integration: Review `/gowa-implementation/adapter/whatsapp-adapter.js`

**Questions?**
- Review IMPLEMENTATION_GUIDE.md
- Check TROUBLESHOOTING section in GOWA README.md

---

**Status:** 🟢 Ready for deployment  
**Last Updated:** 2026-02-27  
**Maintained By:** MarkPlus Indonesia Dev Team
