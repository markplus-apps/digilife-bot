# 🚀 WA Bot Deployment Guide

How to deploy, configure, and manage the WA Bot system.

---

## 📋 Prerequisites

- ✅ VPS access (SSH): `root@145.79.10.104`
- ✅ Node.js v16+ installed
- ✅ PM2 installed globally (`npm install -g pm2`)
- ✅ PostgreSQL running on port 5432
- ✅ Qdrant running on port 6333
- ✅ Fonnte paid plan (active, no watermark)
- ✅ Git: local repo synced with `markplus-apps/digilife-bot`

---

## 🔧 Local Development Setup

### 1. Install Dependencies

```bash
# Navigate to project directory
cd "c:\Users\hp\OneDrive - MarkPlus Indonesia ,PT\MARKPLUS\Automation\Ai Agent"

# Install Node modules (if not exists)
npm install dotenv express axios pm2
```

### 2. Configure Environment Variables

**Local `.env`:**
```bash
# OpenAI
OPENAI_API_KEY=sk-proj-...

# Service Ports
PORT=3005
FONNTE_PORT=3010

# Service URLs
BOT_API_URL=http://localhost:3010/send-message
DIGILIFE_URL=http://localhost:3005/inbound

# Fonnte
FONNTE_TOKEN=yTJG4CJUpe1nvNB6MaAP

# PostgreSQL (external IP for local dev)
DATABASE_URL=postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb

# Legacy (unused, kept for reference)
SPREADSHEET_ID=1US9SqWny3hA6JogGSCxh6sOkr98ZrzzxER_mdAuqpsg
```

**VPS `/root/Digilife/.env`** (uses localhost for DB):
```bash
OPENAI_API_KEY=sk-proj-...
PORT=3005
BOT_API_URL=http://localhost:3010/send-message
FONNTE_TOKEN=yTJG4CJUpe1nvNB6MaAP
DATABASE_URL=postgresql://digilife_user:MasyaAllah26@localhost:5432/digilifedb
```

> ⚠️ `DATABASE_URL` di VPS harus pakai `localhost`, bukan external IP.

### 3. Start Services Locally (for testing)

```powershell
# Terminal 1: Start digilife AI engine
node digilife-service.js
# Expected output: ✅ Service running on port 3005

# Terminal 2: Start fonnte-bot gateway
node fonnte-bot.js
# Expected output: ✅ Fonnte bot running on port 3010

# Terminal 3: Start reminder service
node reminder-service.js
# Expected output: ✅ Reminder service running on port 3015
```

### 4. Deploy Update to VPS

```powershell
# Standard deploy workflow (from local PowerShell)
git add -A
git commit -m "your commit message"
git push; ssh root@145.79.10.104 "cd /root/Digilife && git pull && pm2 restart digilife reminder"
```

Expected output:
```
branch 'main' of https://github.com/markplus-apps/digilife-bot
1 file changed, X insertions(+)
✅ PostgreSQL connected (history + customer lookup)
✅ Loaded 45 pricing items from PostgreSQL
✅ Loaded 531 customer records from PostgreSQL
✅ Data pre-loaded successfully
```

> ⚠️ `fonnte-bot.js` di-deploy manual (bukan via git), karena ada di `/root/digilife-bot/` yang berbeda path.

---

## 🖥️ VPS Deployment (Production)

### 1. Connect to VPS

```bash
ssh root@145.79.10.104
```

### 2. Service Locations on VPS

| PM2 Name | PM2 ID | Port | Script |
|----------|--------|------|--------|
| `digilife` | 19 | 3005 | `/root/Digilife/digilife-service.js` |
| `reminder` | 20 | 3015 | `/root/Digilife/reminder-service.js` |
| `fonnte-bot` | 26 | 3010 | `/root/digilife-bot/fonnte-bot.js` |

### 3. Deploy Digilife + Reminder (git-based)

```powershell
# From local machine (PowerShell)
git push; ssh root@145.79.10.104 "cd /root/Digilife && git pull && pm2 restart digilife reminder"
```

### 4. Deploy fonnte-bot (manual scp)

```powershell
# Only needed when fonnte-bot.js has changes
scp fonnte-bot.js root@145.79.10.104:/root/digilife-bot/
ssh root@145.79.10.104 "pm2 restart fonnte-bot"
```

### 5. Initial Setup (first-time only)

```bash
# On VPS
cd /root/Digilife
git init
git remote add origin https://github.com/markplus-apps/digilife-bot.git
git pull origin main
pm2 start digilife-service.js --name "digilife"
pm2 start reminder-service.js --name "reminder"
pm2 save
pm2 startup
```

## 📊 PM2 Management

### View All Services

```bash
pm2 list
```

Expected output:
```
┌─────────┬─────────────┬───────┬───────┬──────────┐
│ id      │ name        │ port  │ pid   │ status   │
├─────────┼─────────────┼───────┼───────┼──────────┤
│ 19      │ digilife    │ 3005  │ xxxx  │ online   │
│ 20      │ reminder    │ 3015  │ xxxx  │ online   │
│ 26      │ fonnte-bot  │ 3010  │ xxxx  │ online   │
└─────────┴─────────────┴───────┴───────┴──────────┘
```

### Common Commands

```bash
# Start service
pm2 start service-name

# Stop service
pm2 stop service-name

# Restart service
pm2 restart service-name

# View logs
pm2 logs service-name

# Delete service
pm2 delete service-name

# Save current setup
pm2 save

# Restore on reboot
pm2 startup
```

---

## 🧪 Testing

### 1. Test fonnte-bot Connection

```bash
# Check port listening
netstat -tulpn | grep 3010

# Test send-message endpoint
curl -X POST http://localhost:3010/send-message \
  -H "Content-Type: application/json" \
  -d '{"to": "628128933008", "text": "test ping"}'
```

### 2. Test digilife Service

```bash
# Send test inbound message
curl -X POST http://localhost:3005/inbound \
  -H "Content-Type: application/json" \
  -d '{"sender": "628128933008", "message": "halo"}'

# Expected response: JSON with processed message
```

### 3. Test Reminder Service

```bash
# Trigger H-5 check manually
curl "http://localhost:3015/trigger-reminder?type=h5"
# Expected: {"success":true, "message":"H-5 Complete: sent X/Y reminder(s)"}
```
psql -U digilife_user -d digilifedb -c "\dt"

# Query conversation history
psql -U digilife_user -d digilifedb -c "SELECT * FROM conversations LIMIT 1;"

# Expected: Table with conversation records
```

### 4. Test Reminder Service

```bash
# Check if running
pm2 logs reminder

# Expected output: Cron schedule logging
```

---

## 🔍 Monitoring & Logging

### Real-time Logs

```bash
# All services
pm2 logs

# Specific service
pm2 logs digilife

# Last 100 lines
pm2 logs digilife --lines 100
```

### Database Monitoring

```bash
# Connect to PostgreSQL
psql -U digilife_user -d digilifedb

# View conversation count
SELECT COUNT(*) FROM conversations;

# View recent conversations
SELECT customer_phone, message_text, created_at 
FROM conversations 
ORDER BY created_at DESC 
LIMIT 10;

# View reminder context
SELECT * FROM conversation_metadata 
WHERE reminder_triggered = true 
LIMIT 5;
```

---

## 🚨 Troubleshooting

### Issue: "Connection refused" on port 3005

```bash
# Check if service running
pm2 list

# Check logs
pm2 logs digilife

# Restart service
pm2 restart digilife

# Verify port
netstat -tulpn | grep 3005
```

### Issue: PostgreSQL connection fails

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check credentials
psql -U digilife_user -d digilifedb -c "SELECT 1"

# Verify .env variables match
cat .env | grep DB_
```

### Issue: Nginx not routing correctly

```bash
# Test nginx config
sudo nginx -t

# Check if running
sudo systemctl status nginx

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Issue: Bot not sending messages

```bash
# Check fonnte-bot logs
pm2 logs fonnte-bot

# Test send endpoint
curl -X POST http://localhost:3010/send-message \
  -H "Content-Type: application/json" \
  -d '{"to": "628128933008", "text": "test"}'

# Check FONNTE_TOKEN in .env
cat /root/digilife-bot/.env | grep FONNTE_TOKEN
```

---

## 📈 Performance Optimization

### 1. PostgreSQL Indexing

```sql
-- Add indexes for faster queries
CREATE INDEX idx_conversations_phone ON conversations(customer_phone);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX idx_metadata_reminder ON conversation_metadata(reminder_triggered);
```

### 2. PM2 Configuration

`/root/Digilife/ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'digilife',
    script: 'digilife-service.js',
    env_file: '/root/Digilife/.env',
    max_memory_restart: '500M',
  }, {
    name: 'reminder',
    script: 'reminder-service.js',
    env_file: '/root/Digilife/.env',
    max_memory_restart: '300M',
  }]
};
```

`/root/digilife-bot/ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'fonnte-bot',
    script: 'fonnte-bot.js',
    env_file: '/root/digilife-bot/.env',
  }]
};
```

### 3. Connection Pooling

`digilife-service.js` uses connection pooling via `DATABASE_URL`:
```javascript
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

---

## 🔐 Security Checklist

- [ ] Change PostgreSQL password
- [ ] Set .env file permissions: `chmod 600 .env`
- [ ] Configure firewall to block unused ports
- [ ] Use SSL for Nginx (optional, for HTTPS)
- [ ] Backup PostgreSQL regularly (`pg_dump`)

---

## 📖 Related Documentation

### Technical Guides
- **[Architecture](./ARCHITECTURE.md)** - System design & data flow details
- **[PostgreSQL Guide](./POSTGRESQL.md)** - Database schema & queries
- **[Git Workflow](./GIT-WORKFLOW.md)** - Development workflow & deployment automation

### Migration & Optimization
- **[GOWA Migration](./GOWA-MIGRATION.md)** - Migrate from Fonnte to GOWA (save Rp 51M/5 years!)

### Quick References
- Automated deployment? → [GIT-WORKFLOW.md](./GIT-WORKFLOW.md#-helper-scripts)
- Want to save costs? → [GOWA-MIGRATION.md](./GOWA-MIGRATION.md)
- Database issues? → [POSTGRESQL.md](./POSTGRESQL.md)

---

**Last Updated:** 2026-02-27  
**Version:** 3.1 (Fonnte + PostgreSQL + Git Workflow)  
**Level:** Intermediate
