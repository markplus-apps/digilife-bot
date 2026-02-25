# 🖥️ VPS Setup Guide

Step-by-step guide to set up the VPS from scratch.

---

## 📋 Prerequisites

- VPS with Linux (Ubuntu 20.04+)
- SSH access as root
- ~10GB disk space
- Basic Linux knowledge

---

## 🔧 Part 1: System Setup

### 1.1 Update System

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git nano build-essential
```

### 1.2 Install Node.js & NPM

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version    # Should be v18+
npm --version     # Should be v9+
```

### 1.3 Install PM2 Globally

```bash
npm install -g pm2

# Verify
pm2 --version

# Enable startup on reboot
pm2 startup systemd -u root --hp /root
```

---

## 🗄️ Part 2: PostgreSQL Setup

### 2.1 Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib

# Verify
sudo systemctl status postgresql
```

### 2.2 Create Database & User

```bash
# Switch to postgres user
sudo -u postgres psql

# Inside PostgreSQL:
CREATE DATABASE digilifedb;
CREATE USER digilife_user WITH PASSWORD 'MasyaAllah26';
ALTER ROLE digilife_user SET client_encoding TO 'utf8';
ALTER ROLE digilife_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE digilife_user SET default_transaction_deferrable TO on;
ALTER ROLE digilife_user SET default_transaction_read_only TO off;
GRANT ALL PRIVILEGES ON DATABASE digilifedb TO digilife_user;
\q
```

### 2.3 Verify Connection

```bash
psql -U digilife_user -d digilifedb -c "SELECT 1"
# Should return: 1
```

### 2.4 Enable Remote Access (Optional)

```bash
# Edit config
sudo nano /etc/postgresql/13/main/postgresql.conf

# Find and change:
# listen_addresses = 'localhost'
# TO:
# listen_addresses = '*'

# Edit pg_hba.conf
sudo nano /etc/postgresql/13/main/pg_hba.conf

# Add at end:
# host    digilifedb    digilife_user    0.0.0.0/0    md5

# Restart PostgreSQL
sudo systemctl restart postgresql
```

---

## 🔍 Part 3: Qdrant Vector Database

### 3.1 Install Qdrant

```bash
mkdir -p /opt/qdrant
cd /opt/qdrant

# Download Qdrant (latest version)
wget https://github.com/qdrant/qdrant/releases/download/v1.7.0/qdrant-x86_64-unknown-linux-gnu.zip
unzip qdrant-*.zip
rm qdrant-*.zip

# Make executable
chmod +x qdrant
```

### 3.2 Create Systemd Service

```bash
sudo nano /etc/systemd/system/qdrant.service
```

Add:
```ini
[Unit]
Description=Qdrant Vector Database
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/qdrant
ExecStart=/opt/qdrant/qdrant --port 6333
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

### 3.3 Start Qdrant

```bash
sudo systemctl daemon-reload
sudo systemctl enable qdrant
sudo systemctl start qdrant

# Verify
sudo systemctl status qdrant

# Check port
curl http://localhost:6333/health
# Should return: {"status":"ok"}
```

---

## 🌐 Part 4: Nginx Setup

### 4.1 Install Nginx

```bash
sudo apt install -y nginx

# Verify
sudo systemctl status nginx
```

### 4.2 Configure Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/default
```

Replace with:
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
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4.3 Restart Nginx

```bash
sudo nginx -t    # Test config
sudo systemctl restart nginx

# Verify
curl http://localhost:3001/health
```

---

## 📁 Part 5: Directory Structure

### 5.1 Create Required Directories

```bash
mkdir -p /root/Baileys/bot-1
mkdir -p /root/Digilife
mkdir -p /root/logs
mkdir -p /backups
```

### 5.2 Set Permissions

```bash
chmod 755 /root/Baileys
chmod 755 /root/Digilife
chmod 755 /root/logs
chmod 755 /backups
```

---

## 🤖 Part 6: Deploy WA Bot Services

### 6.1 Copy Service Files

```bash
# From local machine (if not already copied)
scp bot-1-server.js root@145.79.10.104:/root/Baileys/bot-1/
scp digilife-service.js root@145.79.10.104:/root/Digilife/
scp digilife-service-pg.js root@145.79.10.104:/root/Digilife/
scp reminder-service.js root@145.79.10.104:/root/Digilife/
scp migrate-conversations-table.js root@145.79.10.104:/root/Digilife/
```

### 6.2 Create .env File

```bash
ssh root@145.79.10.104
nano /root/Digilife/.env
```

Add:
```bash
# Server Configuration
PORT=3005
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=digilife_user
DB_PASSWORD=MasyaAllah26
DB_NAME=digilifedb

# Bot Configuration
BOT_API_URL=http://localhost:3010/send-message
DIGILIFE_SERVICE_URL=http://localhost:3005/inbound

# OpenAI
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini

# Qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333
```

### 6.3 Initialize Database

```bash
cd /root/Digilife
node migrate-conversations-table.js

# Expected output:
# ✅ Connected to PostgreSQL
# ✅ Table conversations created
# ✅ Table conversation_metadata created
```

### 6.4 Start Services with PM2

```bash
# wa-bot-1
pm2 start /root/Baileys/bot-1/bot-1-server.js --name "wa-bot-1" --port 3010

# digilife-ai (PostgreSQL version)
pm2 start /root/Digilife/digilife-service-pg.js --name "digilife-ai" --port 3005

# reminder-service
pm2 start /root/Digilife/reminder-service.js --name "reminder-service" --port 3015

# Check status
pm2 list

# Save configuration
pm2 save
```

---

## ✅ Part 7: Verification

### 7.1 Check All Services

```bash
pm2 list

# Expected:
# ┌─────────┬─────────────┬──────┬───────┬─────────┐
# │ id      │ name        │ port │ pid   │ status  │
# ├─────────┼─────────────┼──────┼───────┼─────────┤
# │ 0       │ wa-bot-1    │ 3010 │ XXXX  │ online  │
# │ 1       │ digilife-ai │ 3005 │ XXXX  │ online  │
# │ 2       │ reminder    │ 3015 │ XXXX  │ online  │
# └─────────┴─────────────┴──────┴───────┴─────────┘
```

### 7.2 Check Ports

```bash
netstat -tulpn | grep -E ':3010|:3005|:3015|:3001|:5432|:6333'

# Expected: All ports listening
```

### 7.3 Test Connectivity

```bash
# Test PostgreSQL
psql -U digilife_user -d digilifedb -c "SELECT COUNT(*) FROM conversations"

# Test Qdrant
curl http://localhost:6333/health

# Test Nginx
curl http://localhost:3001/health

# Test Services
pm2 logs wa-bot-1 | head -5
pm2 logs digilife-ai | head -5
```

---

## 🔐 Part 8: Security

### 8.1 Configure Firewall

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 3001/tcp    # Nginx
sudo ufw enable
sudo ufw status
```

### 8.2 Set File Permissions

```bash
chmod 600 /root/Digilife/.env
chmod 700 /root/Baileys/bot-1
chmod 700 /root/Digilife
```

### 8.3 SSH Key Configuration (Optional)

```bash
# Disable password auth (use SSH keys instead)
sudo nano /etc/ssh/sshd_config

# Change:
# PasswordAuthentication yes
# To:
# PasswordAuthentication no
# PubkeyAuthentication yes

sudo systemctl restart ssh
```

---

## 📊 Part 9: Monitoring Setup

### 9.1 Install PM2 Monitoring

```bash
pm2 install pm2-logrotate

# Configure rotation (optional)
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 9.2 Setup Log Rotation

```bash
sudo nano /etc/logrotate.d/pm2-log
```

Add:
```
/root/logs/*.log
/root/.pm2/logs/*.log
{
    daily
    rotate 7
    missingok
    notifempty
    compress
}
```

---

## 📈 Part 10: Optimization

### 10.1 PostgreSQL Performance

```bash
# Connect to PostgreSQL
psql -U digilife_user -d digilifedb

# Create indexes
CREATE INDEX idx_conversations_phone ON conversations(customer_phone);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX idx_metadata_reminder ON conversation_metadata(reminder_triggered);

\q
```

### 10.2 System Tuning

```bash
# Check system limits
ulimit -n

# If needed, increase (edit /etc/security/limits.conf)
* soft nofile 65535
* hard nofile 65535

# Apply
ulimit -n 65535
```

---

## 🔄 Part 11: Backup Strategy

### 11.1 Auto Backup PostgreSQL

```bash
nano /root/backup-postgres.sh
```

Add:
```bash
#!/bin/bash
BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump -U digilife_user digilifedb | gzip > $BACKUP_DIR/digilifedb_$TIMESTAMP.sql.gz
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

```bash
chmod +x /root/backup-postgres.sh

# Add to crontab (daily at 2 AM)
crontab -e

# Add line:
0 2 * * * /root/backup-postgres.sh
```

---

## 🎯 Checklist

- [ ] System package updates
- [ ] Node.js and npm installed
- [ ] PM2 installed globally
- [ ] PostgreSQL installed and configured
- [ ] Qdrant downloaded and running
- [ ] Nginx configured as reverse proxy
- [ ] Directories created
- [ ] .env configured
- [ ] Database migration ran successfully
- [ ] All 3 services running (pm2 list)
- [ ] All ports listening
- [ ] Firewall configured
- [ ] Backups scheduled
- [ ] Logs rotating

---

## 🆘 Troubleshooting

### Port Already in Use
```bash
# Find what's using port
lsof -i :3005
# Kill and restart
pm2 restart digilife-ai
```

### Can't Connect to PostgreSQL
```bash
# Check service
sudo systemctl status postgresql

# Restart if needed
sudo systemctl restart postgresql

# Test connection
psql -U digilife_user -d digilifedb -c "SELECT 1"
```

### Out of Disk Space
```bash
# Check usage
df -h

# Clean old backups
rm /backups/*.sql.gz

# Clean npm cache
npm cache clean --force
```

---

**Created:** 2026-02-24
**Last Updated:** 2026-02-24
**Difficulty:** Advanced
**Est. Time:** 30-45 minutes
