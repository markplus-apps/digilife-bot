# 🔄 Git Workflow & Deployment

Development workflow untuk DigiLife WA Bot - dari local development hingga production deployment.

---

## 📋 Overview

Workflow ini adalah **standard practice** untuk semua code changes:
- ✅ Bugfix (contoh: pricing hallucination fix)
- ✅ New features (contoh: reminder H-3, multi-language)
- ✅ Infrastructure changes (contoh: GOWA migration)
- ✅ Security patches
- ✅ Database migrations

**Prinsip:**
- **Local → GitHub → VPS Test → VPS Production**
- Code review via Pull Request
- Automated testing (optional)
- Rollback capability

---

## 🏗️ Architecture Flow

```
┌─────────────────────────────────────────────────┐
│  LOCAL DEVELOPMENT                              │
│  (Laptop: Windows)                              │
│  ├─ Edit digilife-service.js                    │
│  ├─ Test locally (node, npm test)               │
│  └─ Git commit                                  │
└────────────────┬────────────────────────────────┘
                 │
                 │ git push origin feature/xyz
                 ▼
┌─────────────────────────────────────────────────┐
│  GITHUB REPOSITORY                              │
│  https://github.com/markplus-apps/digilife-bot  │
│  ├─ main (production)                           │
│  ├─ develop (testing)                           │
│  └─ feature/* (work-in-progress)                │
└────────────────┬────────────────────────────────┘
                 │
                 │ Pull Request & Code Review
                 ▼
┌─────────────────────────────────────────────────┐
│  VPS TEST (Optional)                            │
│  145.79.10.105 (separate instance)              │
│  └─ git pull → test 24h → verify                │
└────────────────┬────────────────────────────────┘
                 │
                 │ Approved
                 ▼
┌─────────────────────────────────────────────────┐
│  VPS PRODUCTION                                 │
│  145.79.10.104                                  │
│  └─ git pull → pm2 restart → monitor            │
└─────────────────────────────────────────────────┘
```

---

## 📁 Repository Structure

```
Ai Agent/                               ← Local directory
├── .git/                               ← Git repository
├── .gitignore                          ← Exclude .env, logs, node_modules
│
├── digilife-service.js                 ← Main AI engine
├── fonnte-bot.js                       ← Fonnte gateway
├── reminder-service.js                 ← Reminder scheduler
│
├── package.json                        ← Dependencies
├── package-lock.json
│
├── .env.example                        ← Template (di git)
├── .env                                ← Secrets (NOT in git)
│
├── gowa-implementation/                ← GOWA migration package
│   ├── docker/
│   │   └── docker-compose.yml
│   ├── config/
│   │   └── .env.example
│   ├── adapter/
│   │   └── whatsapp-adapter.js
│   └── docs/
│
├── DOCUMENTATION/                      ← Project docs
│   └── WA-BOT/
│       ├── README.md
│       ├── DEPLOYMENT.md
│       ├── ARCHITECTURE.md
│       ├── POSTGRESQL.md
│       ├── GIT-WORKFLOW.md            ← You are here
│       └── GOWA-MIGRATION.md
│
└── scripts/                            ← Helper scripts
    ├── deploy.sh
    ├── backup-db.sh
    └── health-check.sh
```

---

## 🌿 Branching Strategy

### Branch Types

```
main                    ← Production (stable, deployed)
  │
  ├─ develop            ← Testing branch (merge feature here first)
  │    │
  │    ├─ feature/gowa-integration        ← New feature
  │    ├─ feature/pricing-accuracy-fix    ← Enhancement
  │    ├─ bugfix/hallucination            ← Bug fix
  │    └─ hotfix/critical-security        ← Urgent production fix
  │
  └─ release/v1.2.0     ← Release preparation
```

### Branch Naming Convention

| Type | Format | Example |
|------|--------|---------|
| Feature | `feature/short-description` | `feature/gowa-integration` |
| Bugfix | `bugfix/issue-description` | `bugfix/pricing-hallucination` |
| Hotfix | `hotfix/critical-issue` | `hotfix/security-patch` |
| Release | `release/vX.Y.Z` | `release/v1.2.0` |
| Docs | `docs/documentation-name` | `docs/api-reference` |

---

## 🚀 Development Workflow

### Step 1: Create Feature Branch

```bash
# Ensure you're on latest main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/gowa-integration

# Or bugfix
git checkout -b bugfix/pricing-accuracy
```

### Step 2: Make Changes Locally

```bash
# Edit files
code digilife-service.js

# Test locally
node digilife-service.js

# Check status
git status
```

### Step 3: Commit Changes

```bash
# Stage files
git add digilife-service.js

# Commit with descriptive message
git commit -m "feat: implement GOWA adapter integration

- Add WhatsAppAdapter abstraction layer
- Support Fontte and GOWA provider switching
- Add /api/admin/switch-provider endpoint
- Update message sending to use adapter

Resolves #123"
```

**Commit Message Format:**
```
<type>: <short summary>

<detailed description>

<footer>
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `refactor:` Code restructuring
- `test:` Add/update tests
- `chore:` Maintenance tasks

### Step 4: Push to GitHub

```bash
# Push feature branch
git push origin feature/gowa-integration

# First time pushing branch
git push -u origin feature/gowa-integration
```

### Step 5: Create Pull Request

**Via GitHub Web:**
1. Go to https://github.com/markplus-apps/digilife-bot
2. Click "Pull Requests" → "New Pull Request"
3. Base: `develop`, Compare: `feature/gowa-integration`
4. Fill PR template:
   ```markdown
   ## Description
   Implement GOWA adapter for WhatsApp provider switching
   
   ## Changes Made
   - Added WhatsAppAdapter class
   - Replaced direct Fonnte calls with adapter
   - Added runtime provider switching
   
   ## Testing
   - [x] Tested locally with Fonnte
   - [x] Tested provider switching
   - [ ] Needs VPS test with GOWA
   
   ## Screenshots
   (attach if relevant)
   ```
5. Request review from team
6. Wait for approval

### Step 6: Merge to Develop

```bash
# After PR approved
# Merge via GitHub UI or:
git checkout develop
git merge feature/gowa-integration
git push origin develop

# Delete feature branch (optional)
git branch -d feature/gowa-integration
git push origin --delete feature/gowa-integration
```

### Step 7: Deploy to Test VPS (Optional)

```bash
# SSH to test VPS
ssh root@145.79.10.105

cd /root/Digilife-Test
git fetch origin
git checkout develop
git pull origin develop

# Restart service
pm2 restart digilife-test

# Monitor logs
pm2 logs digilife-test --lines 50
```

**Monitor for 24h:**
- Check error rate
- Verify functionality
- Test edge cases

### Step 8: Merge to Main (Production)

```bash
# After test VPS verification
git checkout main
git merge develop
git push origin main

# Tag release
git tag -a v1.2.0 -m "Release v1.2.0: GOWA integration"
git push origin v1.2.0
```

### Step 9: Deploy to Production

**Option A: Manual Deploy**
```powershell
# From local (PowerShell)
git push
ssh root@145.79.10.104 "cd /root/Digilife && git pull && pm2 restart digilife reminder"
```

**Option B: Automated Script** (Recommended)
```bash
# Create scripts/deploy.sh
./scripts/deploy.sh production
```

---

## 🔧 Helper Scripts

### scripts/deploy.sh

```bash
#!/bin/bash

# Usage: ./scripts/deploy.sh [test|production]

ENVIRONMENT=${1:-production}

if [ "$ENVIRONMENT" = "test" ]; then
  VPS_IP="145.79.10.105"
  VPS_PATH="/root/Digilife-Test"
  PM2_NAME="digilife-test"
  BRANCH="develop"
elif [ "$ENVIRONMENT" = "production" ]; then
  VPS_IP="145.79.10.104"
  VPS_PATH="/root/Digilife"
  PM2_NAME="digilife"
  BRANCH="main"
else
  echo "❌ Invalid environment. Use: test or production"
  exit 1
fi

echo "🚀 Deploying to $ENVIRONMENT ($VPS_IP)..."

ssh root@$VPS_IP << EOF
  cd $VPS_PATH
  
  echo "📥 Pulling latest code from $BRANCH..."
  git fetch origin
  git checkout $BRANCH
  git pull origin $BRANCH
  
  echo "📦 Installing dependencies..."
  npm install --production
  
  echo "⏹️  Stopping service..."
  pm2 stop $PM2_NAME
  
  echo "🔄 Restarting service..."
  pm2 restart $PM2_NAME
  pm2 save
  
  echo "✅ Deployment complete!"
  echo ""
  pm2 logs $PM2_NAME --lines 20
EOF

echo "✅ Deployed to $ENVIRONMENT successfully!"
```

**Make executable:**
```bash
chmod +x scripts/deploy.sh
```

**Usage:**
```bash
# Deploy to test
./scripts/deploy.sh test

# Deploy to production
./scripts/deploy.sh production
```

---

### scripts/backup-db.sh

```bash
#!/bin/bash

# Backup PostgreSQL database

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/backups"
BACKUP_FILE="$BACKUP_DIR/digilifedb_$TIMESTAMP.sql"

echo "🗄️  Backing up database..."

pg_dump -U digilife_user digilifedb > $BACKUP_FILE

if [ $? -eq 0 ]; then
  echo "✅ Backup saved: $BACKUP_FILE"
  
  # Keep only last 7 backups
  ls -t $BACKUP_DIR/*.sql | tail -n +8 | xargs rm -f
else
  echo "❌ Backup failed!"
  exit 1
fi
```

---

### scripts/health-check.sh

```bash
#!/bin/bash

# Check service health

VPS_IP="145.79.10.104"
HEALTH_URL="http://$VPS_IP:3005/api/health"

echo "🔍 Checking service health..."

response=$(curl -s $HEALTH_URL)

if echo "$response" | grep -q "ok"; then
  echo "✅ Service is healthy"
  exit 0
else
  echo "❌ Service unhealthy!"
  echo "Response: $response"
  
  # Optional: Send alert (Slack, email, etc)
  # curl -X POST https://hooks.slack.com/... -d "Service down on $VPS_IP"
  
  exit 1
fi
```

**Run via cron (every 5 minutes):**
```bash
crontab -e

# Add:
*/5 * * * * /root/Digilife/scripts/health-check.sh
```

---

## 🔙 Rollback Procedures

### Scenario 1: Bad Commit in Feature Branch

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Or discard changes completely
git reset --hard HEAD~1
```

### Scenario 2: Revert Merged Pull Request

```bash
# Find commit hash
git log --oneline

# Revert specific commit
git revert abc1234

# Push
git push origin main
```

### Scenario 3: Emergency Rollback (Production)

```bash
# SSH to production
ssh root@145.79.10.104

cd /root/Digilife

# Option A: Reset to previous tag
git fetch --tags
git checkout v1.1.0

# Option B: Reset to specific commit
git log --oneline  # Find good commit
git reset --hard abc1234

# Restart service
pm2 restart digilife

# Monitor
pm2 logs digilife
```

---

## 📝 .gitignore Configuration

```
# Environment variables (SECRETS!)
.env
.env.local
.env.test
.env.production

# Dependencies
node_modules/
package-lock.json  # (optional, keep if you want strict versions)

# Logs
logs/
*.log
pm2-logs/
pm2.log

# OS
.DS_Store
Thumbs.db
desktop.ini

# IDE
.vscode/
.idea/
*.swp
*.swo

# Database backups
backups/*.sql
*.backup

# Temporary files
tmp/
temp/
*.tmp
```

---

## 🔐 Environment Variable Management

### .env.example (In Git)

```bash
# OpenAI
OPENAI_API_KEY=sk-proj-xxxxx

# Service Ports
PORT=3005
FONNTE_PORT=3010

# Service URLs
BOT_API_URL=http://localhost:3010/send-message

# Fonnte
FONNTE_TOKEN=your-fonnte-token

# PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# WhatsApp Provider (fonnte or gowa)
WA_PROVIDER=fonnte

# GOWA (if using)
GOWA_URL=http://localhost:3001
GOWA_USER=admin
GOWA_PASS=changeme
```

### .env (Local, Not in Git)

```bash
# Copy from .env.example and fill real values
cp .env.example .env

# Edit with real credentials
nano .env
```

### .env (Production VPS, Not in Git)

```bash
# On VPS
nano /root/Digilife/.env

# Use localhost for DB (faster & secure)
DATABASE_URL=postgresql://digilife_user:MasyaAllah26@localhost:5432/digilifedb
```

---

## ✅ Pre-Deployment Checklist

**Before pushing to GitHub:**
- [ ] Code tested locally
- [ ] No debug `console.log()` left
- [ ] Environment variables in `.env.example` (not hardcoded)
- [ ] `.gitignore` excludes secrets
- [ ] Commit message descriptive

**Before merging PR:**
- [ ] Code review completed
- [ ] Tests passing (if automated)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if applicable)

**Before deploying to production:**
- [ ] Tested on test VPS (24h)
- [ ] Database backup created
- [ ] Rollback plan ready
- [ ] Team notified
- [ ] Monitoring alerts active

**After deployment:**
- [ ] Service restarted successfully
- [ ] Logs checked (`pm2 logs digilife`)
- [ ] Health check passing
- [ ] Key features tested manually
- [ ] Error rate monitored

---

## 📊 Release Versioning

Follow **Semantic Versioning** (SemVer):

```
v1.2.3
│ │ │
│ │ └─ PATCH (bugfix, no breaking changes)
│ └─── MINOR (new feature, backward compatible)
└───── MAJOR (breaking changes)
```

**Examples:**
- `v1.0.0` - Initial release with Fonnte
- `v1.1.0` - Add anti-annoying filters (new feature)
- `v1.2.0` - GOWA integration (new feature)
- `v1.2.1` - Hotfix for pricing hallucination (bugfix)
- `v2.0.0` - Complete rewrite (breaking changes)

**Tag release:**
```bash
git tag -a v1.2.0 -m "Release v1.2.0: GOWA Integration

Features:
- GOWA adapter for WhatsApp provider switching
- Runtime provider toggle
- Improved monitoring

Bugfixes:
- Fixed pricing hallucination
- Fixed non-registered customer pricing access"

git push origin v1.2.0
```

---

## 🔗 Quick Command Reference

```bash
# Create feature branch
git checkout -b feature/my-feature

# Commit
git add .
git commit -m "feat: description"

# Push
git push origin feature/my-feature

# Deploy to production (one-liner)
git push && ssh root@145.79.10.104 "cd /root/Digilife && git pull && pm2 restart digilife"

# Check status
ssh root@145.79.10.104 "pm2 list && pm2 logs digilife --lines 20"

# Rollback to previous tag
ssh root@145.79.10.104 "cd /root/Digilife && git checkout v1.1.0 && pm2 restart digilife"
```

---

## 🆘 Troubleshooting

### Issue: Git conflicts during merge

```bash
# Pull latest
git pull origin main

# Resolve conflicts manually in editor
# Then:
git add .
git commit -m "fix: resolve merge conflicts"
git push
```

### Issue: PM2 service not restarting

```bash
ssh root@145.79.10.104

# Check PM2 status
pm2 list

# Force restart
pm2 delete digilife
pm2 start digilife-service.js --name digilife
pm2 save
```

### Issue: Database connection fails after deploy

```bash
# Check .env file
cat /root/Digilife/.env

# Verify DATABASE_URL uses localhost on VPS
# Not external IP: localhost:5432 ✅, 145.79.10.104:5432 ❌

# Restart service
pm2 restart digilife
```

---

## 📚 Related Documentation

- **GOWA Migration**: [GOWA-MIGRATION.md](GOWA-MIGRATION.md)
- **Deployment Guide**: [DEPLOYMENT.md](DEPLOYMENT.md)
- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Database**: [POSTGRESQL.md](POSTGRESQL.md)

---

**Last Updated:** 2026-02-27  
**Maintained By:** MarkPlus Indonesia Dev Team
