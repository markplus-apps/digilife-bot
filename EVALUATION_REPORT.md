# 🔍 System Evaluation Report - DigiLife Bot

**Date:** 2026-02-27  
**Evaluator:** AI Agent  
**Scope:** Complete system audit after multiple patches

---

## 🚨 CRITICAL ISSUES

### 1. **LLM HALLUCINATION IN PRICING** (Priority: P0 - BLOCKER)

**Problem:**
- Bot memberikan data pricing yang **TIDAK EXIST** di database
- Example: Spotify 12 bulan (Rp 440K → Rp 330K) - **PRODUCT TIDAK ADA**
- Spotify 6 bulan salah Rp 20.000 (DB: 240K→199K, Bot: 220K→179K)

**Root Cause:**
```javascript
// Line 1986-2004: Build pricing knowledge context
const pricingContextContent = pricingForContext.map(p => {
  const hargaPromo = `*Rp ${p.price.toLocaleString('id-ID')}*`;
  if (p.price_normal > 0 && p.price_normal > p.price) {
    const hargaNormal = `~Rp ${p.price_normal.toLocaleString('id-ID')}~`;
    return `- ${p.product} ${p.duration}: ${hargaNormal} ${hargaPromo}`;
  }
  return `- ${p.product} ${p.duration}: ${hargaPromo}`;
}).join('\n');

// Line 2009: Pass ke LLM yang bisa MENGUBAH/MEMBUAT data baru
const priceResponse = await generateResponse(messageText, null, customerDbName, enrichedKnowledgeContexts, conversationHistory);
```

**Why It Fails:**
- LLM (GPT-4o-mini) temperature 0.7 = masih bisa creative/hallucinate
- Instruction "DILARANG KERAS mengarang" **TIDAK CUKUP** untuk LLM
- LLM sees pattern, invents similar data

**Impact:**
- ❌ Customer terima informasi salah 
- ❌ Pricing tidak akurat → loss of trust
- ❌ Potential legal issue (misleading pricing)

---

### 2. **CONTRADICTORY LOGIC: Manual Format + LLM Reformat** (Priority: P0)

**Problem:**
Code already formats pricing PERFECTLY at line 1986-2004, then asks LLM to format AGAIN.

**Inefficiency:**
1. **Step 1 (Code):** Format pricing dengan benar:
   ```
   - YouTube Premium 1 bulan: ~Rp 76.000~ *Rp 55.000*
   ```

2. **Step 2 (LLM):** Re-interpret dan re-format (bisa salah):
   ```
   - 1 Bulan: Rp 76.000 Rp 55.000 (PROMO)  ← WRONG FORMAT
   ```

**Why Contradictory:**
- Code sudah benar tapi tidak digunakan langsung
- LLM instruction: "Format: bullet list dengan -" tapi code ALREADY did this
- Double work + risk of LLM ignoring instruction

---

### 3. **REGISTERED CUSTOMER ONLY BIAS** (Priority: P1)

**Problem:**
```javascript
// Line 1978
else if (intent.intent === 'price_inquiry' && isRegisteredCustomer) {
  // Show pricing
}

// Line 2056 - NON-registered customer
if (!isRegisteredCustomer) {
  responseText = `Terima kasih sudah menghubungi! 👋`;  // NO INFO!
}
```

**Impact:**
- Non-registered customer **NEVER** get pricing info
- They ask "Harga YouTube berapa?" → Bot: "Terima kasih! 👋" (useless!)
- **Lost conversion opportunity** - mereka mau jadi customer!

**Should Be:**
- Non-registered SHOULD get pricing (to convert them)
- Just skip personalized stuff (nama, renewal reminder)

---

### 4. **INTENT PRIORITY UNCLEAR** (Priority: P1)

**Problem:**
```javascript
// Line 1978: Check price_inquiry first
else if (intent.intent === 'price_inquiry' && isRegisteredCustomer) { ... }

// Line 2016: Check support keywords AFTER
const supportKeywords = ['otp', 'verif', 'kode', ...];
const isNeedingSupport = supportKeywords.some(kw => messageText.toLowerCase().includes(kw));
```

**Scenario That Fails:**
User: "Harga Netflix berapa? Tapi saya OTP belum terima"
- Intent: `price_inquiry` (checked first)
- Bot shows pricing
- **IGNORES "OTP belum terima"** karena sudah return di price_inquiry block!

**Should Be:**
Priority order: SUPPORT > RENEWAL > AVAILABILITY > PRICE > GENERAL

---

### 5. **REDUNDANT CLARIFICATION LOGIC** (Priority: P2)

**Duplication:**

**Location 1:** extractIntent() line 1293
```javascript
let clarificationGuidance = '';
if (confidence >= 80) {
  clarificationGuidance = `LANGSUNG JAWAB tanpa perlu tanya ulang!`;
}
```

**Location 2:** generateResponse() line 1585
```javascript
systemPrompt += `⚠️ GUNAKAN CONVERSATION HISTORY: ... Jangan tanya ulang produk yang sudah disebutkan dalam history.`;
```

**Problem:**
- Same logic in 2 places
- If one changes, other might not sync
- Maintenance nightmare

---

### 6. **OVER-CLARIFICATION STILL HAPPENS** (Priority: P1)

**Real Conversation Evidence:**
```
User: "Ka mau tanya dong"
Bot: "Ka Haryadi, bisa dijelaskan lebih detail tentang yang mau ditanyakan?"

User: "Lagi ada promo apa nih skr?"
Bot: "Ka Haryadi, untuk promo saat ini, bisa lebih spesifik tentang produk yang ka maksud?"
```

**Why:**
- Message "mau tanya dong" (13 chars) pass shouldSkipShortMessage (limit 5 chars)
- Confidence score = 0% (no product mentioned)
- extractIntent() → `unclear` intent
- LLM asks clarification despite smart filters

**Real Issue:**
Smart filters only work for VERY short messages (<5 char).
Medium vague messages (5-20 char) still trigger clarification.

---

### 7. **INEFFICIENT PRICE FILTERING**

**Line 1982-1989:** Filter pricing by product
```javascript
const productFilter = intent.product ? intent.product.toLowerCase() : null;
let pricingForContext = pricingData;
if (productFilter) {
  const filtered = pricingData.filter(p =>
    p.product.toLowerCase().includes(productFilter) ||
    productFilter.includes(p.product.toLowerCase().split(' ')[0])
  );
  if (filtered.length > 0) pricingForContext = filtered;
}
```

**Problem:**
- Filter includes "productFilter.includes(p.product...)" - too loose!
- User asks "YouTube" → matches "YouTube Premium" ✅
- User asks "premium" → matches ALL premium products ❌ (YouTube, Netflix, Spotify, etc)

---

## 📊 SUMMARY

| Issue | Severity | Impact | Status |
|-------|----------|--------|--------|
| LLM Hallucination | P0 | Data akurasi salah | 🔴 Critical |
| Manual + LLM Double Format | P0 | Inefficient + error prone | 🔴 Critical |
| Non-registered No Pricing | P1 | Lost conversion | 🟡 High |
| Intent Priority Unclear | P1 | Wrong response type | 🟡 High |
| Over-clarification | P1 | Annoying UX | 🟡 High |
| Redundant Logic | P2 | Maintenance issue | 🟠 Medium |
| Loose Price Filtering | P2 | Wrong products shown | 🟠 Medium |

---

## ✅ RECOMMENDED SOLUTIONS

### Solution 1: REMOVE LLM FROM PRICING (P0)

**Current:**
```javascript
// Build pricing string → pass to LLM → LLM re-formats (bisa salah)
const priceResponse = await generateResponse(...);
```

**Recommended:**
```javascript
// Direct string building - NO LLM
function buildPricingResponse(customerName, products, renewalReminder = null) {
  let response = renewalReminder || '';
  response += `Ka ${customerName}, berikut harga produk:\n\n`;
  
  products.forEach(p => {
    if (p.price_normal > 0 && p.price_normal > p.price) {
      response += `- ${p.product} ${p.duration}: ~Rp ${p.price_normal.toLocaleString('id-ID')}~ *Rp ${p.price.toLocaleString('id-ID')}*\n`;
    } else {
      response += `- ${p.product} ${p.duration}: *Rp ${p.price.toLocaleString('id-ID')}*\n`;
    }
  });
  
  return response;
}

// Line 1978 - Use direct building
else if (intent.intent === 'price_inquiry') {
  const filtered = pricingData.filter(p => /* strict filter */);
  responseText = buildPricingResponse(customerDbName, filtered, renewalReminder);
}
```

**Benefits:**
✅ 100% accurate (code-controlled)
✅ Consistent formatting
✅ Fast (no LLM call)
✅ No hallucination risk

---

### Solution 2: FIX INTENT PRIORITY (P0)

**Create intent priority system:**
```javascript
// BEFORE intent detection
const intentPriority = {
  support: 1,      // Highest
  renewal: 2,
  subscription_inquiry: 3,
  price_inquiry: 4,
  availability_inquiry: 5,
  greeting: 6,
  unclear: 7       // Lowest
};

// AFTER detection
const hasSupport = supportKeywords.some(kw => messageText.toLowerCase().includes(kw));
if (hasSupport) {
  intent.intent = 'support';  // OVERRIDE
}

// Then process by priority
if (intent.intent === 'support') { ... }
else if (intent.intent === 'renewal') { ... }
else if (intent.intent === 'subscription_inquiry') { ... }
// etc
```

---

### Solution 3: ALLOW NON-REGISTERED TO SEE PRICING (P1)

**Change line 1978:**
```javascript
// OLD
else if (intent.intent === 'price_inquiry' && isRegisteredCustomer) {

// NEW
else if (intent.intent === 'price_inquiry') {
  // Anyone can see pricing (conversion opportunity!)
  // Just skip personalization for non-registered
  const customerName = isRegisteredCustomer ? customerDbName || senderName : null;
  const filtered = /* ... */;
  responseText = buildPricingResponse(customerName, filtered);
}
```

---

### Solution 4: STRICTER VAGUE MESSAGE FILTER (P1)

**Expand shouldSkipShortMessage:**
```javascript
function shouldSkipVagueMessage(messageText, conversationHistory = []) {
  const msg = messageText.toLowerCase().trim();
  
  // Very vague patterns
  const vaguePatterns = [
    /^mau tanya$/,
    /^ada apa aja\??$/,
    /^ada promo\??$/,
    /^promo apa\??$/,
    /^lagi promo\??$/
  ];
  
  const isVague = vaguePatterns.some(pattern => pattern.test(msg));
  
  if (isVague) {
    // Instead of asking clarification, give OVERVIEW
    return {
      skip: false,
      useOverview: true  // Flag to send category overview
    };
  }
  
  return { skip: false, useOverview: false };
}
```

**Then provide category overview:**
```
Halo ka! Kita punya produk di kategori:

🎬 Streaming: Netflix, YouTube Premium, Disney+
🎵 Music: Spotify, Apple Music  
💼 Productivity: Microsoft 365, Canva Pro

Mau tanya tentang produk yang mana?
```

---

### Solution 5: CONSOLIDATE CLARIFICATION LOGIC (P2)

**Remove from extractIntent()** - let handler decide:
```javascript
// extractIntent() should ONLY return intent data
{
  intent: 'unclear',
  product: null,
  confidence: 30
}

// Handler decides what to do
if (intent.intent === 'unclear' && intent.confidence < 60) {
  if (detectPreviousClarification(conversationHistory)) {
    // Don't ask again - use LLM with full context
  } else {
    // Ask clarification
  }
}
```

---

## 🎯 IMPLEMENTATION PRIORITY

**Phase 1 (URGENT - Today):**
1. ✅ Remove LLM from pricing response (Solution 1)
2. ✅ Fix intent priority (Solution 2)  
3. ✅ Allow non-registered see pricing (Solution 3)

**Phase 2 (High Priority - This Week):**
4. ✅ Add vague message filter with category overview (Solution 4)
5. ✅ Consolidate clarification logic (Solution 5)

**Phase 3 (Nice to Have):**
6. ✅ Stricter product filtering
7. ✅ More comprehensive testing

---

## 📝 TESTING CHECKLIST

After fixes, test these scenarios:

**Pricing Accuracy:**
- [ ] "Harga Spotify 6 bulan?" → Should show: ~Rp 240.000~ *Rp 199.000*
- [ ] "Promo YouTube apa aja?" → Should show ONLY products in DB
- [ ] "Harga Netflix 12 bulan?" → Should show all Netflix variants (1,3,6,12 bulan)

**Non-Registered Customer:**
- [ ] Non-registered asks price → Should get pricing (not just "Terima kasih")
- [ ] Non-registered asks support → Should get support response

**Intent Priority:**
- [ ] "Harga Netflix berapa? Tapi OTP saya belum terima" → Should prioritize SUPPORT
- [ ] "Mau perpanjang tapi transfer ke mana?" → Should show payment info (RENEWAL)

**Vague Messages:**
- [ ] "Mau tanya dong" → Should show category overview (not over-clarify)
- [ ] "Ada promo?" → Should show overview or popular promos
- [ ] "ok" (short) → Should SKIP (silent)

---

**Status:** 🔴 Critical issues found, immediate action required  
**Next Step:** Implement Phase 1 fixes (Priority P0)

