# ⚡ GOWA Deployment Checklist (Quick Reference)

**Print this out or bookmark it during deployment**

---

## 📋 Pre-Deployment (Week 1)

### Prerequisites
- [ ] Read README.md (overview)
- [ ] Read IMPLEMENTATION_GUIDE.md (full process)
- [ ] Have DigitalOcean/VPS account ready
- [ ] Have database credentials (PostgreSQL)

### VPS Setup (Day 1-2)
- [ ] Provision Ubuntu 22.04 VPS (1GB RAM, $5/month)
- [ ] SSH into VPS: `ssh root@your-vps-ip`
- [ ] Run Docker installer: `curl -fsSL https://get.docker.com -o get-docker.sh`
- [ ] Install Docker Compose: `sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose`
- [ ] Verify: `docker --version && docker-compose --version`

### GOWA Deployment (Day 3)
- [ ] Copy `gowa-implementation/` folder to VPS `/opt/gowa/`
- [ ] Copy `.env.example` to `.env`: `cp config/.env.example config/.env`
- [ ] Edit `.env` with your settings:
  - [ ] `WEBHOOK_URL` = your bot server
  - [ ] `WEBHOOK_SECRET` = random secret key
  - [ ] `APP_BASIC_AUTH` = admin:password
- [ ] Deploy: `docker-compose up -d`
- [ ] Verify running: `docker-compose logs -f gowa` (wait for "Listening on port 3001")
- [ ] Test health: `curl http://localhost:3001/health`

---

## 🔧 Integration (Week 1, Day 4)

### Update digilife-service.js
- [ ] Add import at top:
  ```javascript
  const WhatsAppAdapter = require('./gowa-implementation/adapter/whatsapp-adapter');
  const whatsappAdapter = new WhatsAppAdapter();
  whatsappAdapter.setProvider('fondte');
  ```
- [ ] Find all `axios.post(BOT_API_URL, ...)` calls
- [ ] Replace with: `await whatsappAdapter.sendMessage(chatJid, responseText)`
- [ ] Find image sending, replace with: `await whatsappAdapter.sendImage(chatJid, url, caption)`
- [ ] Add provider switch endpoint (optional):
  ```javascript
  app.post('/api/admin/switch-provider', (req, res) => {
    whatsappAdapter.switchProvider(req.body.provider);
    res.json({ provider: whatsappAdapter.getProviderInfo() });
  });
  ```

### Testing
- [ ] Run `node tests/gowa-adapter.test.js` (should pass all tests)
- [ ] Restart digilife: `pm2 restart digilife`
- [ ] Send test message (verify logs show message sent)
- [ ] Check logs: `pm2 logs digilife` and `docker-compose logs gowa`

---

## 🚀 Phase 1: Parallel Testing (Week 2)

### Traffic Routing
- [ ] Update code to send 20% traffic to GOWA:
  ```javascript
  const random = Math.random();
  if (random < 0.2) whatsappAdapter.switchProvider('gowa');
  else whatsappAdapter.switchProvider('fondte');
  ```
- [ ] Restart service: `pm2 restart digilife`

### Monitoring (Daily)
- [ ] Check success rates: `curl http://localhost:3005/api/admin/metrics`
- [ ] GOWA success rate: should be >99%
- [ ] Fontype success rate: baseline (should still be high)
- [ ] Check error logs: `pm2 logs digilife --err`
- [ ] GOWA logs: `docker-compose logs gowa` (on VPS)

### Decision
- [ ] After 24h: Success rate >99%? → Proceed to Week 2
- [ ] Issues found? → Investigate or rollback: `whatsappAdapter.switchProvider('fondte')`

---

## 🔄 Phase 2: Gradual Migration (Week 3)

### Traffic Schedule
- [ ] **Day 1:** 20% GOWA → Monitor → Success rate >99%?
- [ ] **Day 2:** 20% GOWA → Monitor → Success rate >99%?
- [ ] **Day 3:** Increase to 50% GOWA → Monitor → Success rate >99%?
- [ ] **Day 4:** 50% GOWA → Monitor → Success rate >99%?
- [ ] **Day 5:** Increase to 80% GOWA → Monitor → Success rate >99%?
- [ ] **Day 6:** 80% GOWA → Monitor → Success rate >99%?
- [ ] **Day 7:** Ready to go 100%

### Code Changes (Per Day)
```javascript
// Day 1-2: if (random < 0.2)
// Day 3-4: if (random < 0.5)
// Day 5-6: if (random < 0.8)
// Day 7: whatsappAdapter.switchProvider('gowa'); // Always
```

### Monitoring Metrics
- [ ] Message success rate (visual graph)
- [ ] Average response time (should decrease)
- [ ] Error rate (should stay near 0%)
- [ ] Customer complaints (should be same)

---

## ✅ Phase 3: Production Switch (Week 4)

### Before Full Switch
- [ ] Success rate maintained >99% for 3+ days?
- [ ] No customer complaints?
- [ ] Response time stable or better?
- [ ] Database migrations completed?

### Full Switch
- [ ] Set GOWA to 100%: `whatsappAdapter.switchProvider('gowa');` always
- [ ] Restart: `pm2 restart digilife`
- [ ] Verify: `pm2 logs digilife` (all messages show "via gowa")

### Stability Check (48 hours)
- [ ] Hour 1: Check every message sends
- [ ] Hour 2-4: Send multiple test conversations
- [ ] Day 1: Monitor metrics, check error rate
- [ ] Day 2: Confirm no issues, stable operation

### Final Steps
- [ ] Update .env: `WA_PROVIDER=gowa` (for future restarts)
- [ ] Cancel Fontte subscription (after 2-week stability confirmation)
- [ ] Document GOWA operations (maintenance, monitoring)
- [ ] Archive Fontte configuration (backup)

---

## 📊 Quick Metrics Check

**Command to check everything:**
```bash
# On your bot server:
curl http://localhost:3005/api/admin/metrics
curl http://localhost:3005/api/admin/provider-status

# On GOWA VPS:
docker-compose logs gowa | tail -20
docker stats gowa
```

**Expected metrics:**
```
GOWA Success Rate: >99%
Fontte Success Rate: >99%
Avg Latency: 200-300ms
Error Rate: <1%
CPU Usage (GOWA): <10%
Memory Usage (GOWA): 60-100MB
```

---

## 🔙 Rollback Commands

**If anything goes wrong, execute:**

```bash
# Switch back to Fontte
curl -X POST http://localhost:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "fontte"}'

# Or immediate service restart:
pm2 restart digilife

# Check provider switched:
curl http://localhost:3005/api/admin/provider-status
```

**Expected output:**
```json
{ "provider": "fontte", "status": "ready" }
```

---

## 🔐 Security Checklist

- [ ] WEBHOOK_SECRET is random (not "secret" or common words)
- [ ] GOWA basic auth changed from default (`admin:changeme`)
- [ ] PostgreSQL password strong and unique
- [ ] VPS firewall allows only necessary ports (22, 3001, 3005)
- [ ] HTTPS enabled for webhook URLs
- [ ] No credentials in git history
- [ ] .env file not committed to git (add to .gitignore)

---

## 📁 File Structure on VPS

```bash
/opt/gowa/
├── docker/
│   └── docker-compose.yml
├── config/
│   └── .env
├── adapter/
│   └── whatsapp-adapter.js
├── docs/
├── tests/
└── README.md

# Check from VPS:
ls -la /opt/gowa/config/.env
```

---

## 🆘 Emergency Contacts

**If GOWA crashes:**
1. Check logs: `docker-compose logs gowa`
2. Restart: `docker-compose restart gowa`
3. Fallback: `whatsappAdapter.switchProvider('fontte')`

**Common issues:**
- Port 3001 occupied? Change in docker-compose.yml
- Webhook not firing? Check URL and secret in .env
- Database error? Verify PostgreSQL is running

---

## ✨ Deployment Timeline Summary

```
Week 1 (4-5 days):
  Day 1-2: VPS setup + Docker
  Day 3: Deploy GOWA
  Day 4: Integrate adapter, test 20% traffic

Week 2 (5-7 days):
  Monitor 20% traffic (24h per day)
  Confirm >99% success rate
  Prepare for increase

Week 3 (5-7 days):
  Day 1-2: 20% → 50% GOWA
  Day 3-4: 50% → 80% GOWA
  Day 5-7: Final testing, prepare 100%

Week 4 (5-7 days):
  Day 1: Switch to 100% GOWA
  Day 2-3: Monitor stability
  Day 4-5: Confirm no issues
  Day 6-7: Cancel Fontte, optimize
```

---

## 📌 Key Contacts / Resources

**GOWA GitHub:** https://github.com/aldinokemal/go-whatsapp-web-multidevice  
**Adapter Code:** `gowa-implementation/adapter/whatsapp-adapter.js`  
**Tests:** `gowa-implementation/tests/gowa-adapter.test.js`

---

## ✅ SignOff

- [ ] All tests passing
- [ ] All monitoring endpoints working
- [ ] Team trained on GOWA operations
- [ ] Rollback procedure documented
- [ ] Ready for production

**Status:** 🟢 Ready to deploy

**Deployment Date:** ___________

**Deployed By:** ___________

**Approved By:** ___________

---

*Keep this checklist handy during deployment!*

