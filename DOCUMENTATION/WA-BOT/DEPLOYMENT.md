# 🚀 WA Bot Deployment Guide

How to deploy, configure, and manage the WA Bot system.

---

## 📋 Prerequisites

- ✅ VPS access (SSH): `root@145.79.10.104`
- ✅ Node.js v16+ installed
- ✅ PM2 installed globally (`npm install -g pm2`)
- ✅ PostgreSQL running on port 5432
- ✅ Qdrant running on port 6333
- ✅ Baileys QR code scanned

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

Create `.env` file:
```bash
# WA Bot Configuration
BOT_API_URL=http://localhost:3010/send-message
DIGILIFE_SERVICE_URL=http://localhost:3005/inbound

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=digilife_user
DB_PASSWORD=MasyaAllah26
DB_NAME=digilifedb

# OpenAI
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini

# Google Sheets (Legacy)
GOOGLE_SHEETS_ID=your_sheets_id
GOOGLE_API_KEY=your_api_key

# Port Configuration
WA_BOT_PORT=3010
DIGILIFE_PORT=3005
REMINDER_PORT=3015
```

### 3. Start Services Locally

```bash
# Terminal 1: Start wa-bot-1
node bot-1-server.js
# Expected output: ✅ Bot running on port 3010

# Terminal 2: Start digilife-ai (Current version - Google Sheets)
node digilife-service.js
# Expected output: ✅ Service running on port 3005

# Terminal 3: Start reminder-service
node reminder-service.js
# Expected output: ✅ Reminder service running on port 3015
```

### 4. Test the Flow

```bash
# Terminal 4: Send test message
curl -X POST http://localhost:3010/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "628128933008@c.us",
    "message": "Test message from bot"
  }'
```

---

## 🖥️ VPS Deployment (Production)

### 1. Connect to VPS

```bash
# SSH into VPS
ssh root@145.79.10.104
cd /root
```

### 2. Deploy wa-bot-1

```bash
# Create directory if not exists
mkdir -p /root/Baileys/bot-1

# Copy from local
scp bot-1-server.js root@145.79.10.104:/root/Baileys/bot-1/

# Connect and start
ssh root@145.79.10.104
cd /root/Baileys/bot-1

# Start with PM2
pm2 start bot-1-server.js --name "wa-bot-1" --port 3010
```

### 3. Deploy digilife-ai (Google Sheets Version)

```bash
# Create directory
mkdir -p /root/Digilife

# Copy service
scp digilife-service.js root@145.79.10.104:/root/Digilife/

# Deploy
ssh root@145.79.10.104
cd /root/Digilife
pm2 start digilife-service.js --name "digilife-ai" --port 3005
```

### 4. Deploy reminder-service

```bash
# Copy service
scp reminder-service.js root@145.79.10.104:/root/Digilife/

# Deploy
ssh root@145.79.10.104
cd /root/Digilife
pm2 start reminder-service.js --name "reminder-service" --port 3015
```

### 5. Configure Nginx Reverse Proxy

```bash
# Connect to VPS
ssh root@145.79.10.104

# Check/edit Nginx config
nano /etc/nginx/sites-available/default
```

Required configuration:
```nginx
server {
    listen 3001;
    server_name _;

    location / {
        proxy_pass http://localhost:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔑 PostgreSQL Migration (NEW)

### Step 1: Create Tables

```bash
# Connect to VPS
ssh root@145.79.10.104

# Copy migration script
scp migrate-conversations-table.js root@145.79.10.104:/root/Digilife/

# Run migration
cd /root/Digilife
node migrate-conversations-table.js

# Expected output:
# ✅ Connected to PostgreSQL
# ✅ Created tables: conversations, conversation_metadata
# ✅ Tables ready for use
```

### Step 2: Deploy PostgreSQL Version

```bash
# Copy new service
scp digilife-service-pg.js root@145.79.10.104:/root/Digilife/

# On VPS: Stop old service
ssh root@145.79.10.104
pm2 stop digilife-ai
pm2 delete digilife-ai

# Start new PostgreSQL version
cd /root/Digilife
pm2 start digilife-service-pg.js --name "digilife-ai" --port 3005

# Verify logs
pm2 logs digilife-ai
```

---

## 📊 PM2 Management

### View All Services

```bash
pm2 list
```

Expected output:
```
┌─────────┬─────────────┬──────┬───────┬──────────┐
│ id      │ name        │ port │ pid   │ status   │
├─────────┼─────────────┼──────┼───────┼──────────┤
│ 0       │ wa-bot-1    │ 3010 │ 1234  │ online   │
│ 1       │ digilife-ai │ 3005 │ 1235  │ online   │
│ 2       │ reminder    │ 3015 │ 1236  │ online   │
└─────────┴─────────────┴──────┴───────┴──────────┘
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

### 1. Test wa-bot-1 Connection

```bash
# SSH into VPS
ssh root@145.79.10.104

# Check if listening
netstat -tulpn | grep 3010
# Expected: LISTEN ... 3010 ... node

# Or test locally
curl http://localhost:3010/status
```

### 2. Test digilife-ai Service

```bash
# Send test message
curl -X POST http://localhost:3005/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "628128933008",
    "text": "Hello",
    "isFromMe": false
  }'

# Expected response: JSON with processed message
```

### 3. Test PostgreSQL Integration

```bash
# Check if tables exist
psql -U digilife_user -d digilifedb -c "\dt"

# Query conversation history
psql -U digilife_user -d digilifedb -c "SELECT * FROM conversations LIMIT 1;"

# Expected: Table with conversation records
```

### 4. Test Reminder Service

```bash
# Check if running
pm2 logs reminder-service

# Expected output: Cron schedule logging
```

---

## 🔍 Monitoring & Logging

### Real-time Logs

```bash
# All services
pm2 logs

# Specific service
pm2 logs digilife-ai

# Last 100 lines
pm2 logs digilife-ai --lines 100
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
pm2 logs digilife-ai

# Restart service
pm2 restart digilife-ai

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
# Check Baileys socket
pm2 logs wa-bot-1 | grep -i qr

# Scan QR code again if needed
pm2 delete wa-bot-1
pm2 start bot-1-server.js --name "wa-bot-1"

# Check for error messages
pm2 logs wa-bot-1
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

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'wa-bot-1',
    script: 'bot-1-server.js',
    instances: 1,
    max_memory_restart: '500M',
    env: { PORT: 3010 }
  }, {
    name: 'digilife-ai',
    script: 'digilife-service-pg.js',
    instances: 1,
    max_memory_restart: '500M',
    env: { PORT: 3005 }
  }]
};
```

### 3. Connection Pooling

Ensure `digilife-service-pg.js` uses connection pooling:
```javascript
const pool = new Pool({
  max: 20,          // Max connections
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

## 📖 Related Guides

- [Architecture](./ARCHITECTURE.md) - System design details
- [PostgreSQL Integration](./POSTGRESQL_INTEGRATION.md) - Database details
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues

---

**Last Updated:** 2026-02-24  
**Version:** 2.1 (PostgreSQL)  
**Level:** Intermediate
