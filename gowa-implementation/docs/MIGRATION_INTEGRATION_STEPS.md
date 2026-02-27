# 🔀 GOWA Migration Guide for digilife-service.js

**Purpose:** Step-by-step instructions for integrating the GOWA adapter into your existing bot code.

**Scope:** Zero-downtime migration from Fonnte → GOWA  
**Time Required:** ~2 hours for integration + testing  
**Risk Level:** Low (adapter provides fallback to Fonnte)

---

## 🎯 Overview

Your current bot sends WhatsApp messages like this:

```javascript
// CURRENT (Fonnte only)
await axios.post(BOT_API_URL, {
  to: chatJid,
  text: responseText,
  headers: { Authorization: `Bearer ${FON_TOKEN}` }
});
```

After integration:

```javascript
// NEW (Fonnte or GOWA, automatic switching)
await whatsappAdapter.sendMessage(chatJid, responseText);
```

The adapter handles routing, retry logic, and provider switching automatically.

---

## 📝 Step 1: Update Imports

### In digilife-service.js, at the top:

**BEFORE:**
```javascript
const axios = require('axios');
const BOT_API_URL = 'https://api.fonnte.com/send';
const FON_TOKEN = process.env.FON_TOKEN;
```

**AFTER:**
```javascript
const axios = require('axios');
const BOT_API_URL = 'https://api.fonnte.com/send';  // Keep for fallback
const FON_TOKEN = process.env.FON_TOKEN;             // Keep for fallback

// NEW: Import GOWA adapter
const WhatsAppAdapter = require('./gowa-implementation/adapter/whatsapp-adapter');
const whatsappAdapter = new WhatsAppAdapter();

// Initialize adapter with current provider (start with Fonnte)
whatsappAdapter.setProvider('fonnte');
```

---

## 📝 Step 2: Update Message Sending

Find all instances of direct API calls. Usually in the main message handler.

### Location: digilife-service.js, search for `BOT_API_URL` or `axios.post`

**BEFORE:**
```javascript
// Old code sending via Fonnte directly
async function sendWhatsAppMessage(chatJid, messageText) {
  try {
    const response = await axios.post(BOT_API_URL, {
      to: chatJid,
      text: messageText,
    }, {
      headers: { Authorization: `Bearer ${FON_TOKEN}` }
    });
    
    console.log('Message sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to send message:', error.message);
    throw error;
  }
}

// Called everywhere like:
await sendWhatsAppMessage(chatJid, "Hello World!");
```

**AFTER:**
```javascript
// New code using adapter
async function sendWhatsAppMessage(chatJid, messageText) {
  try {
    const response = await whatsappAdapter.sendMessage(chatJid, messageText);
    
    console.log(`✅ Message sent via ${response.provider}:`, response);
    return response;
  } catch (error) {
    console.error('Failed to send message:', error.message);
    throw error;
  }
}

// Called exactly the same way:
await sendWhatsAppMessage(chatJid, "Hello World!");
```

### Example of a typical message sending section (around lines 2100-2150):

**BEFORE:**
```javascript
if (shouldRespond) {
  const responseText = await generateResponse(message, context);
  
  try {
    await axios.post(BOT_API_URL, {
      to: chatJid,
      text: responseText,
    }, {
      headers: { Authorization: `Bearer ${FON_TOKEN}` }
    });
    
    console.log('Response sent');
  } catch (error) {
    console.error('Send failed:', error);
  }
}
```

**AFTER:**
```javascript
if (shouldRespond) {
  const responseText = await generateResponse(message, context);
  
  try {
    const result = await whatsappAdapter.sendMessage(chatJid, responseText);
    console.log(`✅ Response sent via ${result.provider}`);
  } catch (error) {
    console.error('Send failed:', error);
  }
}
```

---

## 📝 Step 3: Update Image Sending

Similar pattern for images.

### Location: Search for image posting (usually with media)

**BEFORE:**
```javascript
async function sendWhatsAppImage(chatJid, imageUrl, caption) {
  try {
    await axios.post(BOT_API_URL, {
      to: chatJid,
      image: imageUrl,
      caption: caption || '',
    }, {
      headers: { Authorization: `Bearer ${FON_TOKEN}` }
    });
  } catch (error) {
    console.error('Image send failed:', error);
  }
}
```

**AFTER:**
```javascript
async function sendWhatsAppImage(chatJid, imageUrl, caption) {
  try {
    const result = await whatsappAdapter.sendImage(chatJid, imageUrl, caption);
    console.log(`✅ Image sent via ${result.provider}`);
  } catch (error) {
    console.error('Image send failed:', error);
  }
}
```

---

## 📝 Step 4: Add Provider Switch Endpoint (Optional)

This lets you switch providers dynamically without restarting.

### Add new webhook endpoint in digilife-service.js:

```javascript
// Around line 1450, add this new route:

app.post('/api/admin/switch-provider', (req, res) => {
  const { provider } = req.body;
  
  // Validate provider
  if (!['fonnte', 'gowa'].includes(provider)) {
    return res.status(400).json({ 
      error: 'Invalid provider. Must be "fonnte" or "gowa"' 
    });
  }
  
  try {
    whatsappAdapter.switchProvider(provider);
    const info = whatsappAdapter.getProviderInfo();
    
    console.log(`🔀 Switched to ${provider} provider`);
    
    res.json({
      success: true,
      message: `Switched to ${provider}`,
      provider: info
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message 
    });
  }
});

// Also add GET endpoint to check current provider:
app.get('/api/admin/provider-status', (req, res) => {
  const info = whatsappAdapter.getProviderInfo();
  res.json(info);
});
```

**Usage:**
```bash
# Check current provider
curl http://localhost:3005/api/admin/provider-status

# Switch to GOWA
curl -X POST http://localhost:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "gowa"}'

# Switch back to Fonnte (if needed)
curl -X POST http://localhost:3005/api/admin/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "fonnte"}'
```

---

## 📝 Step 5: Update Configuration

### In digilife-service.js environment setup:

**ADD these environment variables:**

```javascript
// Around line 150, add:

// WhatsApp Provider Configuration
const WA_PROVIDER = process.env.WA_PROVIDER || 'fonnte';  // 'fontte' or 'gowa'
const GOWA_URL = process.env.GOWA_URL || 'http://localhost:3001';
const GOWA_USER = process.env.GOWA_USER || 'admin';
const GOWA_PASS = process.env.GOWA_PASS || 'changeme';

console.log(`⚙️  WhatsApp Provider: ${WA_PROVIDER}`);
console.log(`⚙️  GOWA URL: ${GOWA_URL}`);

// Initialize adapter with provider from env
whatsappAdapter.setProvider(WA_PROVIDER);
```

### In your .env file (if using environment variables):

```bash
# WhatsApp Provider (fonte or gowa)
WA_PROVIDER=fonfte

# GOWA Configuration (only needed if using GOWA)
GOWA_URL=http://localhost:3001
GOWA_USER=admin
GOWA_PASS=your-secure-password
```

---

## 📝 Step 6: Testing the Integration

### Test 1: Verify Imports Load Correctly

```bash
# In digilife-service.js, add to startup logs:
console.log('✅ WhatsApp Adapter loaded successfully');
console.log('📡 Current provider:', whatsappAdapter.getProviderInfo());
```

**Expected output:**
```
✅ WhatsApp Adapter loaded successfully
📡 Current provider: { provider: 'fonfte', status: 'ready' }
```

### Test 2: Send Test Message

```bash
# Via digilife webhook or direct test
const testResult = await whatsappAdapter.sendMessage(
  '628123456789@c.us',
  'Integration test message'
);

console.log('Test result:', testResult);
```

**Expected output:**
```
Test result: {
  provider: 'fonfte',
  messageId: 'ABC123...',
  status: 'sent',
  timestamp: '2026-02-27T10:30:00Z'
}
```

### Test 3: Provider Switch

```bash
// Test switching provider
whatsappAdapter.switchProvider('gowa');
const info = whatsappAdapter.getProviderInfo();
console.log('Switched to:', info.provider); // Should be 'gowa'

// Switch back
whatsappAdapter.switchProvider('fonfte');
console.log('Switched to:', info.provider); // Should be 'fontte'
```

---

## 🚀 Step 7: Gradual Traffic Migration

### Week 1: Testing (20% GOWA)

```javascript
// In digilife-service.js, modify message sending:

async function sendWhatsAppMessage(chatJid, messageText) {
  // Route 20% of traffic to GOWA, 80% to Fonnte
  const testTraffic = Math.random();
  
  if (testTraffic < 0.2) {
    whatsappAdapter.switchProvider('gowa');
    console.log('🧪 TEST TRAFFIC: Routing to GOWA (20%)');
  } else {
    whatsappAdapter.switchProvider('fonfte');
    console.log('📡 Production traffic: Routing to Fonnte (80%)');
  }
  
  try {
    const result = await whatsappAdapter.sendMessage(chatJid, messageText);
    console.log(`✅ Sent via ${result.provider}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed with ${whatsappAdapter.getProviderInfo().provider}`);
    throw error;
  }
}
```

### Week 2: Increase Traffic (50% GOWA)

```javascript
if (testTraffic < 0.5) {
  whatsappAdapter.switchProvider('gowa');
} else {
  whatsappAdapter.switchProvider('fonfte');
}
```

### Week 3: Majority Traffic (80% GOWA)

```javascript
if (testTraffic < 0.8) {
  whatsappAdapter.switchProvider('gowa');
} else {
  whatsappAdapter.switchProvider('fontte');
}
```

### Week 4: Production (100% GOWA)

```javascript
whatsappAdapter.switchProvider('gowa');
```

---

## 📊 Step 8: Monitoring & Metrics

### Add metric tracking:

```javascript
// At the top of digilife-service.js
const metrics = {
  fontetSent: 0,
  fontteErrors: 0,
  gowaSent: 0,
  gowaErrors: 0,
  lastSwitchTime: null,
};

// Update in sendWhatsAppMessage:
async function sendWhatsAppMessage(chatJid, messageText) {
  try {
    const result = await whatsappAdapter.sendMessage(chatJid, messageText);
    
    // Track metrics
    if (result.provider === 'fontte') {
      metrics.fonteSent++;
    } else {
      metrics.gowaSent++;
    }
    
    return result;
  } catch (error) {
    // Track errors
    if (whatsappAdapter.getProviderInfo().provider === 'fontte') {
      metrics.fontteErrors++;
    } else {
      metrics.gowaErrors++;
    }
    
    throw error;
  }
}

// Add metrics endpoint:
app.get('/api/admin/metrics', (req, res) => {
  res.json({
    metrics,
    provider: whatsappAdapter.getProviderInfo(),
    fontteSuccessRate: (metrics.fonteSent / (metrics.fonteSent + metrics.fontteErrors)) * 100,
    gowaSuccessRate: (metrics.gowaSent / (metrics.gowaSent + metrics.gowaErrors)) * 100,
  });
});
```

---

## ✅ Integration Checklist

Complete these in order:

- [ ] Step 1: Add WhatsAppAdapter import
- [ ] Step 2: Replace all axios.post calls with adapter.sendMessage()
- [ ] Step 3: Replace image sending with adapter.sendImage()
- [ ] Step 4: (Optional) Add provider switch endpoint
- [ ] Step 5: Update environment variables
- [ ] Step 6: Run integration tests
- [ ] Step 7: Test with 20% traffic
- [ ] Step 8: Setup monitoring endpoints
- [ ] Confirm all messages sending correctly
- [ ] Ready for gradual migration

---

## 🔙 Rollback Procedure

If anything goes wrong:

```javascript
// Emergency switch back to Fonnte
whatsappAdapter.switchProvider('fontte');

// Or restart service:
pm2 restart digilife

// Verify provider switched:
curl http://localhost:3005/api/admin/provider-status
```

---

## 📝 Code Comparison Summary

| Operation | Old (Fonnte) | New (Adapter) |
|-----------|-------------|---------------|
| Send text | `axios.post(BOT_API_URL, {...})` | `whatsappAdapter.sendMessage(chatId, text)` |
| Send image | `axios.post(BOT_API_URL, {...})` | `whatsappAdapter.sendImage(chatId, url, caption)` |
| Check status | Manual polling | `whatsappAdapter.getStatus()` |
| Switch provider | Restart service | `whatsappAdapter.switchProvider('gowa')` |
| Error handling | Manual try/catch | Automatic retry + fallback |

---

## 🎯 Timeline

```
Week 1 (Testing):
  └─ Deploy GOWA
  └─ Integrate adapter
  └─ Run tests
  └─ Monitor 20% traffic

Week 2 (Gradual Migration):
  └─ Day 1-2: 20% GOWA
  └─ Day 3-4: 50% GOWA
  └─ Monitor metrics

Week 3 (Increase Traffic):
  └─ Day 1-2: 80% GOWA
  └─ Day 3-4: Monitor performance
  └─ Prepare for 100%

Week 4 (Production):
  └─ Switch to 100% GOWA
  └─ Monitor 48 hours
  └─ Cancel Fonnte subscription
  └─ Document operations
```

---

## 💡 Tips

1. **Save backup:** Keep your current digilife-service.js as backup before changes
2. **Test locally first:** Use Node.js to test adapter locally
3. **Gradual is better:** Don't jump to 100% immediately
4. **Monitor is critical:** Watch logs during migration
5. **Rollback is fast:** You can switch providers in seconds if needed

---

## 🆘 Common Issues

### Issue: "whatsappAdapter is not defined"
**Solution:** Add import at top of file:
```javascript
const WhatsAppAdapter = require('./gowa-implementation/adapter/whatsapp-adapter');
const whatsappAdapter = new WhatsAppAdapter();
```

### Issue: "GOWA server connection failed"
**Solution:** Verify GOWA is running:
```bash
docker ps | grep gowa
docker logs gowa
```

### Issue: "Adapter doesn't recognize provider"
**Solution:** Use only 'fontte' or 'gowa':
```javascript
whatsappAdapter.switchProvider('gowa');  // ✅
whatsappAdapter.switchProvider('GOWA');  // ❌ Wrong case
```

---

## 📞 Next Steps

1. **Backup** your current digilife-service.js
2. **Follow** each step above in order
3. **Test** the adapter with 20% traffic
4. **Monitor** success rates (should be >99%)
5. **Gradually increase** traffic as confidence grows
6. **Switch** to 100% GOWA by Week 4

**Status:** Ready for integration ✅

---

*Made with ❤️ for MarkPlus Indonesia*

