# 🏗️ Infrastructure Overview

Complete infrastructure architecture, port mapping, and service configuration.

---

## 🌍 VPS Specification

**Server Details:**
- **Host:** 145.79.10.104
- **OS:** Linux (Ubuntu 20.04+)
- **Architecture:** x86_64
- **Access:** SSH root@145.79.10.104

---

## 📍 Port Architecture

### Service Ports

```
PORT  │ SERVICE               │ TYPE      │ LISTEN        │ PURPOSE
──────┼──────────────────────┼───────────┼───────────────┼────────────────────────
3010  │ wa-bot-1             │ TCP IPv4  │ 0.0.0.0:3010  │ WhatsApp socket (Baileys)
3005  │ digilife-ai          │ TCP IPv6  │ [::]:3005     │ AI engine & message processing
3015  │ reminder-service     │ TCP IPv6  │ [::]:3015     │ Scheduled reminders (H-7,H-5,H-1)
3001  │ nginx-proxy          │ TCP IPv4  │ 0.0.0.0:3001  │ Reverse proxy → 3005
5432  │ postgresql           │ TCP Both  │ localhost     │ Database (conversations, customers)
6333  │ qdrant               │ TCP Both  │ localhost     │ Vector DB (semantic search)
───────┴──────────────────────┴───────────┴───────────────┴────────────────────────
```

### Network Flow

```
WhatsApp Messages
    ↓
[PORT 3010] wa-bot-1 (Receives messages)
    ↓
POST /inbound
    ↓
[PORT 3005] digilife-ai (IPv6, Process & respond)
    ↑↓ (Queries)
[PORT 5432] PostgreSQL (Conversations, customers)
[PORT 6333] Qdrant (Knowledge base embeddings)
    ↓
[PORT 3010] wa-bot-1 /send-message (Send response)
    ↓
WhatsApp Output
```

---

## 📁 Directory Structure

### /root (Home)
```
/root/
├── Baileys/
│   └── bot-1/
│       └── server.js           # wa-bot-1 service
│       └── authenticate.json   # Baileys session
│
├── Digilife/
│   ├── digilife-service.js     # AI engine (Google Sheets version)
│   ├── digilife-service-pg.js  # AI engine (PostgreSQL version)
│   ├── reminder-service.js     # Scheduled reminders
│   ├── migrate-conversations-table.js  # Migration script
│   └── .env                    # Environment variables
│
├── nginx/
│   └── sites-available/
│       └── default             # Nginx config (reverse proxy)
│
└── backups/
    └── *.sql.gz                # PostgreSQL daily backups
```

---

## 🗄️ PostgreSQL Configuration

### Connection Details

```
Host:     localhost or 145.79.10.104
Port:     5432
Database: digilifedb
User:     digilife_user
Password: MasyaAllah26
SSL:      (optional)
```

### Database Schema

```sql
── Databases
   └── digilifedb
       └── Public Schema
           ├── customer_master       (Existing)
           ├── customer_subscriptions (Existing)
           ├── products              (Existing)
           ├── groups                (Existing)
           ├── conversations         (NEW)
           └── conversation_metadata (NEW)
```

**Tables:**

| Table | Purpose | Records |
|-------|---------|---------|
| `customer_master` | Customer info | ~500 customers |
| `customer_subscriptions` | Active subscriptions | ~1000 subscriptions |
| `products` | Product catalog | ~20 products |
| `groups` | Reseller groups | ~10 groups |
| `conversations` | Message history (NEW) | Growing |
| `conversation_metadata` | Reminder context (NEW) | Growing |

---

## 🐘 Qdrant Vector Database

### Configuration

```
Host:     localhost
Port:     6333 (HTTP API)
Port:     6334 (gRPC API)
Protocol: HTTP/REST
Collections: Various (product_info, kb_embeddings, etc.)
```

### Usage in System

```javascript
// Search similarity (in digilife-service.js)
const results = await qdrant.search('Netflix', {
  collection_name: 'product_info',
  limit: 5,
  threshold: 0.8
});

// Returns: Similar products/info from knowledge base
```

---

## 🌐 Nginx Reverse Proxy

### Configuration (/etc/nginx/sites-available/default)

```nginx
server {
    listen 3001;
    server_name _;

    location / {
        # Route traffic from port 3001 → 3005
        proxy_pass http://localhost:3005;
        
        # Headers for proper routing
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### Why Nginx?

```
Benefit 1: Port routing (3001 → 3005)
Benefit 2: Future load balancing (multiple backends)
Benefit 3: SSL/HTTPS termination
Benefit 4: Security layer
```

---

## 🔄 Service Management (PM2)

### PM2 Ecosystem Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'wa-bot-1',
      script: '/root/Baileys/bot-1/server.js',
      watch: false,
      instances: 1,
      max_memory_restart: '500M',
      env: {
        PORT: 3010,
        NODE_ENV: 'production',
        DIGILIFE_URL: 'http://localhost:3005/inbound'
      },
      error_file: '/root/logs/wa-bot-1-error.log',
      out_file: '/root/logs/wa-bot-1-out.log'
    },
    {
      name: 'digilife-ai',
      script: '/root/Digilife/digilife-service-pg.js',
      watch: false,
      instances: 1,
      max_memory_restart: '500M',
      env: {
        PORT: 3005,
        NODE_ENV: 'production',
        DB_HOST: 'localhost',
        DB_PORT: 5432
      },
      error_file: '/root/logs/digilife-error.log',
      out_file: '/root/logs/digilife-out.log'
    },
    {
      name: 'reminder-service',
      script: '/root/Digilife/reminder-service.js',
      watch: false,
      instances: 1,
      max_memory_restart: '300M',
      env: {
        PORT: 3015,
        NODE_ENV: 'production'
      },
      error_file: '/root/logs/reminder-error.log',
      out_file: '/root/logs/reminder-out.log'
    }
  ]
};
```

### PM2 Commands

```bash
# Start all services
pm2 start ecosystem.config.js

# View status
pm2 list

# View logs
pm2 logs wa-bot-1
pm2 logs digilife-ai
pm2 logs reminder-service

# Restart single service
pm2 restart digilife-ai

# Stop all
pm2 stop all

# Save startup configuration
pm2 save
pm2 startup
```

---

## 🔐 Firewall Configuration

### UFW Rules

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow Web service (Nginx)
sudo ufw allow 3001/tcp

# Allow internal communication (not exposed)
# 3005, 3010, 3015, 5432, 6333 (block from outside)

# Enable firewall
sudo ufw enable

# Verify rules
sudo ufw status
```

---

## 📊 System Monitoring

### Check Service Status

```bash
# List all processes
pm2 list

# Check specific service
pm2 info wa-bot-1

# Monitor real-time
pm2 monit
```

### Check Ports

```bash
# Check if port listening
netstat -tulpn | grep :3010
netstat -tulpn | grep :3005
netstat -tulpn | grep :3015

# Or with ss command
ss -tulpn | grep :3010
```

### Check Disk Space

```bash
# Overall usage
df -h

# Specific directory
du -sh /root/Digilife
du -sh /var/lib/postgresql
du -sh /backups
```

### Check Memory

```bash
# Overall
free -h

# Per process
ps aux | grep node
```

---

## 🔄 Auto-Restart Configuration

### PM2 Startup

```bash
# Enable PM2 to start on system boot
pm2 startup systemd -u root --hp /root

# Save current PM2 state
pm2 save

# Verify
systemctl status pm2-root
```

### Log Rotation

```bash
# Install logrotate for PM2 logs
pm2 install pm2-logrotate

# Configure rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 📈 Performance Baseline

### Expected Response Times

```
Message Received → Processing → Response Sent
├─ wa-bot-1 receive: <10ms
├─ Network latency: 1-5ms
├─ digilife-ai processing (with PostgreSQL):
│  ├─ History load: 20-50ms
│  ├─ Intent detection: 150-300ms
│  ├─ Response generation: 50-100ms
│  └─ Database save: 10-20ms
├─ Send to wa-bot-1: <10ms
└─ Total: ~250-500ms
```

### Resource Usage

```
Service         │ CPU    │ Memory  │ Notes
────────────────┼────────┼─────────┼─────────────────
wa-bot-1        │ <5%    │ 100-200MB │ Depends on message volume
digilife-ai     │ 10-20% │ 200-400MB │ Higher with PostgreSQL
reminder-service│ <1%    │ 50-100MB  │ Mostly idle until trigger
PostgreSQL      │ 5-15%  │ 300-500MB │ Grows with data
Qdrant          │ <5%    │ 200-400MB │ In-memory vector store
────────────────┴────────┴─────────┴─────────────────
```

---

## 🚨 Common Issues & Solutions

### Issue: Port Already in Use

```bash
# Find process using port 3005
lsof -i :3005

# Kill process if needed
kill -9 <PID>

# Or restart service
pm2 restart digilife-ai
```

### Issue: PostgreSQL Connection Refused

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Restart if needed
sudo systemctl restart postgresql

# Verify connection
psql -U digilife_user -d digilifedb -c "SELECT 1"
```

### Issue: Out of Memory

```bash
# Check memory usage
free -h

# Identify heavy process
ps aux | sort -k4 -nr | head

# Increase PM2 max_memory_restart
pm2 set wa-bot-1 max_memory_restart 1G
pm2 restart wa-bot-1
```

---

## 📖 Related Documentation

- [VPS Setup Guide](./VPS_SETUP.md) - Initial VPS configuration
- [Service Deployment](./SERVICE_DEPLOYMENT.md) - Deploy individual services
- [Monitoring & Logging](./MONITORING.md) - Track system health

---

**Last Updated:** 2026-02-24  
**Infrastructure Version:** 2.1  
**Level:** Intermediate
