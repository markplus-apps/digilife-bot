#!/bin/bash

# VPS Exploration Checklist
# Run these commands in order to verify bot WA Agent sync & config

echo "=========================================="
echo "VPS BOT WA AGENT EXPLORATION CHECKLIST"
echo "=========================================="
echo ""

# STEP 1: Find bot directory
echo "STEP 1: Locate Bot Directory"
echo "---"
echo "Run these to find where bot code is:"
echo ""
echo "  find ~ -name 'digilife-service.js' 2>/dev/null"
echo "  find ~ -name 'bot-1-server.js' 2>/dev/null"
echo "  find / -name 'digilife-service.js' 2>/dev/null | head -5"
echo ""
echo ">> After finding, cd to that directory"
echo ""

# STEP 2: List files
echo "STEP 2: List Bot Files"
echo "---"
echo "  ls -lah *.js | head -20"
echo "  ls -lah .env*"
echo ""

# STEP 3: Check PORT configuration
echo "STEP 3: PORT CONFIGURATION CHECK"
echo "---"
echo "Check bot-1-server.js port:"
echo "  grep -n 'const port' bot-1-server.js"
echo ""
echo "Check digilife-service.js port:"
echo "  grep -n 'const PORT' digilife-service.js"
echo ""
echo "Check reminder-service.js port:"
echo "  grep -n 'const PORT' reminder-service.js"
echo ""

# STEP 4: Check BOT_API_URL endpoint config
echo "STEP 4: SERVICE ENDPOINT CHECK"
echo "---"
echo "Bot to Digilife:"
echo "  grep 'digiLifeServiceUrl' bot-1-server.js"
echo ""
echo "Digilife expects bot at:"
echo "  grep 'const BOT_API_URL' digilife-service.js"
echo ""
echo "Reminder calls bot at:"
echo "  grep 'const BOT_API_URL' reminder-service.js"
echo ""

# STEP 5: Check .env
echo "STEP 5: ENVIRONMENT CONFIGURATION (.env)"
echo "---"
echo "  cat .env"
echo ""
echo "Or just important vars:"
echo "  grep -E '^[A-Z_]+=' .env | sort"
echo ""

# STEP 6: Running services
echo "STEP 6: RUNNING SERVICES"
echo "---"
echo "  ps aux | grep -E 'node|digilife|bot|reminder'"
echo ""
echo "Or check PM2:"
echo "  pm2 list"
echo "  pm2 logs digilife-service --lines 20"
echo "  pm2 logs bot-1-server --lines 20"
echo ""

# STEP 7: Port listening
echo "STEP 7: PORT LISTENING STATUS"
echo "---"
echo "  netstat -tuln | grep LISTEN | grep -E '3010|3001|3005|3015|6333'"
echo ""
echo "Or:"
echo "  ss -tuln | grep LISTEN"
echo ""

# STEP 8: Recent changes
echo "STEP 8: FILE MODIFICATION DATES"
echo "---"
echo "  ls -lh digilife-service.js bot-1-server.js reminder-service.js .env | awk '{print \$6, \$7, \$8, \$9}'"
echo ""

# STEP 9: Git status (if using git)
echo "STEP 9: GIT SYNC STATUS (if applicable)"
echo "---"
echo "  git status"
echo "  git log --oneline -5"
echo "  git diff"
echo ""

# STEP 10: Check QDRANT
echo "STEP 10: QDRANT CONNECTION"
echo "---"
echo "  grep 'QDRANT' .env"
echo "  grep 'QDRANT_URL' digilife-service.js"
echo ""
echo "Test QDRANT connection:"
echo "  curl http://localhost:6333/health"
echo "  curl http://$(grep QDRANT_URL .env | cut -d= -f2):6333/health 2>/dev/null"
echo ""

# STEP 11: Database
echo "STEP 11: DATABASE CONNECTION"
echo "---"
echo "  grep DATABASE .env"
echo "  grep 'SPREADSHEET' .env"
echo ""

# STEP 12: Test API endpoints
echo "STEP 12: TEST API ENDPOINTS"
echo "---"
echo "Test Digilife service (port 3001):"
echo "  curl http://localhost:3001/health 2>/dev/null || echo 'Not responding on 3001'"
echo ""
echo "Test Bot API (port 3010):"
echo "  curl http://localhost:3010/health 2>/dev/null || echo 'Not responding on 3010'"
echo ""
echo "Or send test message:"
echo "  curl -X POST http://localhost:3010/send-message -H 'Content-Type: application/json' -d '{\"to\":\"628128933008@s.whatsapp.net\",\"text\":\"Test\"}'"
echo ""

# STEP 13: Logs
echo "STEP 13: SERVICE LOGS"
echo "---"
echo "If using PM2:"
echo "  pm2 logs --lines 50"
echo ""
echo "Or check system logs:"
echo "  tail -100 /var/log/syslog | grep -i node"
echo ""

# STEP 14: Compare with local
echo "STEP 14: VERIFY SYNC (compare file hash)"
echo "---"
echo "Get MD5 checksums to compare:"
echo "  md5sum *.js | head -10"
echo ""
echo "Then compare with local on Windows:"
echo "  certutil -hashfile C:\\path\\to\\local\\file.js MD5"
echo ""

echo ""
echo "=========================================="
echo "SAVE OUTPUT & REPORT BACK"
echo "=========================================="

