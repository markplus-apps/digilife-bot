# 📚 Digilife Project Documentation

**Master Hub untuk semua catatan dan guides**

---

## 🤖 WA Bot Services

WhatsApp Chatbot AI dengan conversation history dan reminder system.

**Recommended Reading Order:**
1. [📖 WA-BOT Overview](./WA-BOT/README.md) - **START HERE** ⭐
2. [🏗️ Architecture](./WA-BOT/ARCHITECTURE.md) - System design & data flow
3. [🚀 Deployment Guide](./WA-BOT/DEPLOYMENT.md) - Setup, deploy, manage
4. [🗄️ PostgreSQL Integration](./WA-BOT/POSTGRESQL.md) - NEW: Database guide
5. [🐛 Troubleshooting](./WA-BOT/TROUBLESHOOTING.md) - Common issues

**Quick Links:**
- Source Code: `bot-1-server.js`, `digilife-service.js`, `reminder-service.js`
- VPS Location: `/root/Baileys/bot-1/`, `/root/Digilife/`
- Key Files: `migrate-conversations-table.js`, `digilife-service-pg.js`

---

## 🎨 Dashboard (Next.js)

Reseller management dashboard dengan subscription tracking, customer management, dan commission system.

**Recommended Reading Order:**
1. [📖 Dashboard Overview](./DASHBOARD/README.md) - Start here
2. [✨ Features](./DASHBOARD/FEATURES.md) - Phase 1 & Phase 2
3. [🔌 API Endpoints](./DASHBOARD/API_ENDPOINTS.md) - Backend endpoints
4. [📊 Data Structure](./DASHBOARD/DATA_STRUCTURE.md) - Database schema

**Quick Links:**
- Source Code: `/digilife-dashboard/` (Next.js project)
- Run: `npm run dev` (port 3000)
- Deployed: http://145.79.10.104:3000

---

## 🏗️ Infrastructure & Setup

VPS architecture, port mapping, services, dan setup guides.

**Recommended Reading Order:**
1. [📖 Infrastructure Overview](./INFRASTRUCTURE/OVERVIEW.md) - **START HERE** ⭐
2. [🌐 VPS Architecture](./INFRASTRUCTURE/VPS_ARCHITECTURE.md) - Port mapping & services
3. [📋 Setup Guide](./INFRASTRUCTURE/SETUP_GUIDE.md) - First-time VPS setup
4. [⚙️ Configuration](./INFRASTRUCTURE/CONFIGURATION.md) - .env, PM2, Nginx config

**Key Information:**
- VPS: `145.79.10.104` (SSH access)
- Ports: 3010 (wa-bot-1), 3005 (digilife-ai), 3015 (reminder), 3001 (Nginx), 5432 (PostgreSQL)
- Process Manager: PM2
- Database: PostgreSQL 5432
- Vector DB: Qdrant 6333

---

## 📊 Progress & Status

**Current Status:**
- ✅ WA Bot Phase 1: Complete
- ✅ Dashboard Phase 1: Complete  
- 🔄 WA Bot PostgreSQL: Ready for deployment
- ⏳ Dashboard Phase 2: Queued

See [Project Progress](../PROJECT_PROGRESS.md) for detailed timeline.

---

## 🚀 Quick Start

### Setup WA Bot (VPS)
```bash
ssh root@145.79.10.104
cd /root/Digilife
node migrate-conversations-table.js
pm2 restart digilife
pm2 logs digilife
```

### Run Dashboard (Local)
```bash
cd digilife-dashboard
npm run dev  # http://localhost:3000
```

### Check Status
```bash
pm2 list
pm2 logs digilife
curl http://145.79.10.104:3005/health
```

---

## 📁 File Organization

```
/Ai Agent/
├── DOCUMENTATION/ (← YOU ARE HERE)
│   ├── WA-BOT/
│   ├── DASHBOARD/
│   ├── INFRASTRUCTURE/
│   └── README.md
│
├── bot-1-server.js ← WA Bot socket
├── digilife-service.js ← AI Engine
├── digilife-service-pg.js ← PostgreSQL version (NEW)
├── reminder-service.js ← Reminder scheduler
│
├── digilife-dashboard/ ← Next.js project
│   ├── app/
│   ├── components/
│   ├── package.json
│   └── ...
│
├── PROJECT_PROGRESS.md ← Overall progress tracking
└── README.md ← Root level overview (old)
```

---

## 💡 Key Files to Know

### For WA Bot Development
- `bot-1-server.js` - Baileys socket & message receiving
- `digilife-service.js` - AI processing & response generation (Google Sheets)
- `digilife-service-pg.js` - AI processing (PostgreSQL version) 🆕
- `reminder-service.js` - Automated reminders

### For Dashboard Development
- `digilife-dashboard/app/` - Next.js pages
- `digilife-dashboard/components/` - React components
- `digilife-dashboard/lib/db.ts` - PostgreSQL client

### For Configuration
- `.env` - Environment variables
- `.env.bot-1.example` - Bot config template
- `ecosystem.config.json` - PM2 configuration

---

## 🔗 External Links

- **VPS:** 145.79.10.104
- **Dashboard:** http://145.79.10.104:3000
- **Bot API:** http://145.79.10.104:3005
- **Google Sheets:** [Link in IMPORTANT-NOTES.md](../IMPORTANT-NOTES.md)

---

## 📞 Support

- **WA Bot Issues?** → See [WA-BOT/TROUBLESHOOTING.md](./WA-BOT/TROUBLESHOOTING.md)
- **Dashboard Issues?** → Check Dashboard logs: `npm run dev`
- **VPS Issues?** → See [INFRASTRUCTURE/VPS_ARCHITECTURE.md](./INFRASTRUCTURE/VPS_ARCHITECTURE.md)

---

**Last Updated:** 2026-02-24  
**Organized By:** GitHub Copilot (Claude Haiku)
