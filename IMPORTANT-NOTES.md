# CATATAN PENTING - DIGILIFE AI AGENT

## ⚠️ ALWAYS READ THIS FIRST!

### Server Configuration
- **Server IP:** 145.79.10.104
- **Deployment Path:** ~/Digilife/
- **PM2 Services:**
  - `digilife` → Main AI chatbot (port 3005)
  - `reminder` → Auto reminder service (cron-based)
  - `whatsapp-bot-1` → WhatsApp Bot API (port 3010)

### API Endpoints & Ports
- **WhatsApp Bot API:** http://localhost:3010/send-message
  - Script: /root/Baileys/bot-1/server.js
  - Format request: `{to: "628xxx@s.whatsapp.net", text: "message"}`
- **Digilife Service:** http://localhost:3005
  - Main webhook: POST /inbound

### Google Sheets Structure
**Sheet: Customer (A-Q, 17 columns)**
- Column A: No
- Column B: Nama
- Column C: Produk
- Column D: WA Pelanggan
- Column E: Subscription (Group name)
- Column F: Member Since (first time ever customer joined)
- Column G: Start Membership (current subscription start date)
- Column H: End Membership
- Column I: Status Payment
- Column J: Extension Payment
- Column K: Keterangan (TERM)
- Column L: Slot (jumlah slot tersedia)
- Column M: Sisa Hari
- Column N: Hari Lepas
- Column O: Reminder Cluster
- Column P: Reminded H-5 (timestamp)
- Column Q: Reminded H-1 (timestamp)

**New vs Renewal Detection:**
- **NEW Customer**: Column F = Column G (Member since = Start membership)
- **RENEWAL Customer**: Column F ≠ Column G (Member since different from Start membership)

**Sheet: Group (A-F)**
- Column A: No
- Column B: Subscription (group name)
- Column C: Code
- Column D: Email/Login (for Netflix/HBO/Prime: email, for Disney+: phone number)
- Column E: Password/Profile (for Netflix/HBO/Prime: password, for Spotify: profile name only)
- Column F: (Additional data)

**Sheet: Pricing (A-F)**
- Column A: No
- Column B: Product
- Column C: Duration
- Column D: Price
- Column E: Description
- Column F: Category

### Reminder Service Schedule (WIB/UTC+7)
- **H-7 Clear PAID:** 07:01 WIB (00:01 UTC) → Clear column I
- **H-5 Reminder:** 16:30 WIB (09:30 UTC) → Send reminder, update column P
- **H-1 Reminder:** 10:00 WIB (03:00 UTC) → Send reminder, update column Q

**Important:** Server timezone is UTC, cron runs in UTC!
- 07:01 WIB = 00:01 UTC = `1 0 * * *`
- 16:30 WIB = 09:30 UTC = `30 9 * * *`
- 10:00 WIB = 03:00 UTC = `0 3 * * *`

### Override System
- **File:** ~/Digilife/override.txt
- **Format:** One phone per line (digits only, e.g., 628128666521)
- **Commands:**
  - `/disable 628xxx` → Block number
  - `/enable 628xxx` → Unblock number
  - `/list-override` → Show blocked list
- **Name auto-lookup:** From Customer sheet column B

### Availability Detection
- **Method:** SUM of Slot column (Column L) per subscription
- **Parent record filtering:** Skip records without variant number (e.g., "YOUTUBE PREMIUM" → skip, "#YouTube Premium 11" → include)
- **Filter logic:** `const hasVariant = /\d/.test(productName);`

### Common Errors & Solutions
1. **Error 400 on WhatsApp send:** Wrong format, use `{to, text}` not `{jid, message}`
2. **Column Q exceeds grid limits:** Sheet hanya 16 kolom (sudah FIXED - kolom P & Q sudah ada)
3. **YouTube shows KOSONG:** Check parent record filtering, check Group sheet naming consistency
4. **Reminder not sent:** Check WhatsApp Bot API port (3010), check format request

### Deployment Checklist
```bash
# 1. Copy files
scp digilife-service.js root@145.79.10.104:~/Digilife/
scp reminder-service.js root@145.79.10.104:~/Digilife/

# 2. SSH to server
ssh root@145.79.10.104
cd ~/Digilife

# 3. Restart services
pm2 restart digilife
pm2 restart reminder

# 4. Check logs
pm2 logs digilife --lines 50
pm2 logs reminder --lines 50

# 5. Check status
pm2 list
```

### Active Issues Tracking
- [ ] YouTube Premium availability detection - parent record filter added, needs testing
- [ ] Reminder H-1 error 400 - format fixed to {to, text}, waiting for next run at 10:00 WIB
- [x] Kolom P & Q sudah ada di sheet (17 columns total: A-Q)
- [x] Port 3010 confirmed for WhatsApp Bot API
- [x] Bot response filter added - skip short/ambiguous messages to avoid awkward conversations

### Bot Response Filters (Added 2026-02-22)
To prevent bot from giving irrelevant/awkward responses, bot will SKIP auto-reply when:
1. **Short/ambiguous messages** (<15 chars): "Ok", "Oke", "Ya", "Blm", "Blm tf", etc.
2. **Only numbers**: "449.000 kan?", "100000", etc.
3. **New subscription requests**: "mau langganan baru", "akun baru" → Defer to admin immediately
4. **LLM defer conditions**: 
   - Customer request langganan BARU (not renewal)
   - Question is unclear/ambiguous
   - Conversation already involves admin manual handling
   - Payment confirmation messages
   - Question not in knowledge base

**Result:** Bot becomes less intrusive and only responds when confident and helpful.

### Debug Commands
```bash
# Check ports
netstat -tlnp | grep node

# Test WhatsApp API
curl -X POST http://localhost:3010/send-message \
  -H "Content-Type: application/json" \
  -d '{"to": "628xxx@s.whatsapp.net", "text": "Test"}'

# Check availability endpoint
curl http://localhost:3005/availability

# Manual trigger reminder (if needed)
# Edit reminder-service.js to add test endpoint
```

### Files Modified Today (2026-02-22)

---

## 📊 DIGILIFE DASHBOARD UI/UX PROGRESS (FASE 1-2 COMPLETE)

### FASE 1: Visual Polish & Look/Feel ✅ COMPLETE
**Completed:** Premium typography, color system, skeleton loaders, global animations

#### Typography System (`globals.css` + `layout.tsx`)
- ✅ **Font Stack:** Geist Sans (body) + Geist Mono (code) + Inter (premium UI)
- ✅ **Heading Hierarchy:** `.text-h1` to `.text-h6` (plain CSS, responsive)
- ✅ **Body Text:** `.text-body`, `.text-body-sm`, `.text-label`, `.text-caption`
- ✅ **Code Typography:** `.text-code`, `.text-code-sm` (Geist Mono based)
- ✅ **Gradient Background:** Light mode (slate-50 to slate-100), Dark mode (neutral-950 to neutral-900)

#### Color Utility System (`src/lib/colors.ts`)
- ✅ **Status Colors:** `getStatusColors(status)` returns `{text, background, border, icon}` Tailwind classes
- ✅ **Revenue Status:** `getRevenueStatus(currentValue, previousValue)` → `'positive' | 'negative' | 'neutral' | 'warning' | 'critical'`
- ✅ **Inventory Status:** `getInventoryStatus(usedSlots, totalSlots)` → returns percentage + color config
- ✅ **Status Types:** positive (green), negative (red), neutral (gray), warning (yellow), critical (red-bold)

#### Skeleton Loading System (`src/components/ui/skeleton-loader.tsx`)
- ✅ **Components:** `Skeleton`, `CardSkeleton`, `TableSkeleton`, `ChartSkeleton`, `ListItemSkeleton`, `DashboardSkeleton`
- ✅ **Shimmer Animation:** CSS keyframes with 2s infinite sweep (left-to-right)
- ✅ **Hook:** `useSkeletonLoader(isLoading)` for conditional rendering
- ✅ **Dark Mode:** Fully supported with gradient backgrounds

#### Dashboard Refactored (`src/app/dashboard/page.tsx`)
- ✅ **KPI Cards:** Dynamic colors via `getStatusColors()`, hover states, responsive grid
- ✅ **Active animations:** Conditional `animate-pulse-soft` for "Needs Attention" when > 0
- ✅ **Loading state:** `DashboardSkeleton` replaces blank "Loading..." text
- ✅ **Charts enhanced:** Hover shadow effects, consistent Card styling

#### Premium Animations Library (`globals.css`)
- ✅ `.animate-shimmer` (skeleton effect)
- ✅ `.animate-pulse-soft` (attention indicators)
- ✅ `.animate-slide-in-left/right`, `.animate-fade-in`, `.animate-scale-pop`
- ✅ `.transition-premium`, `.transition-color` (smooth interactions)

---

### FASE 2: Inventory Visualization ✅ COMPLETE
**Completed:** SlotVisualizer component with bus seat model, dynamic colors, micro-interactions

#### SlotVisualizer Component (`src/components/ui/slot-visualizer.tsx`)
**Main Component - SlotVisualizer**
- ✅ **Props:**
  - `totalSlots`: Number - total available slots
  - `usedSlots`: Number - currently occupied slots
  - `size`: 'sm' | 'md' | 'lg' - dot size options
  - `maxDisplay`: Number (default 40) - max dots before collapse indicator
  - `className`: Optional CSS classes
  
- ✅ **Visual Elements:**
  1. **Dot Grid:** Circles representing slots (red = used, green = available, orange = 80%+)
  2. **Stats Row:** "Terisi: X / Kosong: Y / Overbooked indicator"
  3. **Percentage Badge:** Dynamic color (red >= 100%, orange >= 80%, green < 80%)
  4. **Progress Bar:** Visual fill indicator matching percentage

- ✅ **Features:**
  - **Hover Effects:** Dots scale 150% on hover with shadow
  - **Animations:** Staggered fade-in (15ms delays per dot)
  - **Responsive:** Flex wrap for mobile, dynamic sizing
  - **Overbooked Handling:** Shows "+X excess" warning with pulsing red dot
  - **Smart Scaling:** Caps display at `maxDisplay` (40), shows "+X lainnya" indicator
  - **Dark Mode:** Full support with slate/emerald/red variants

- ✅ **Color Logic:**
  - **< 80%:** Blue (indigo-400) - plenty available
  - **80-99%:** Orange (orange-400) - warning state
  - **≥ 100%:** Red (red-500) - overbooked with animation

**Compact Badge Component - SlotBadge**
- ✅ **Props:**
  - `totalSlots`, `usedSlots`: Numbers
  - `className`: Optional CSS

- ✅ **Display:** Inline badge "X/Y" with warning emoji (⚠) if overbooked
- ✅ **Use Case:** Perfect for table rows, customer cards, inventory summary tables
- ✅ **Styling:** Matches main visualizer colors, minimal footprint

#### Integration Ready
- ✅ **Powered by:** `getInventoryStatus()` from `colors.ts` (color consistency)
- ✅ **Component Location:** `/src/components/ui/slot-visualizer.tsx`
- ✅ **Export:** Both `SlotVisualizer` and `SlotBadge` exported
- ✅ **Tested with:** Hardcoded demo data (YouTube Premium: 175/175, Spotify: 56/0)

---

### FASE 3: Interactive KPI Dashboard (IN PROGRESS)
**Next Steps:**
- [ ] Integrate SlotVisualizer into KPI cards (show for subscription-based variantsvisualize)
- [ ] Add click handlers to inventory cards → navigate to variant detail page
- [ ] Implement real-time updates via TanStack Query subscriptions
- [ ] Dynamic enable/disable toggle for SlotVisualizer display per variant
- [ ] Group name & variant name dynamic rendering from API

#### Dynamic Enable/Disable Feature (Requested)
**Planned Implementation:**
- [ ] Add `show_inventory_visual` boolean field to database Groups table
- [ ] Admin toggle UI to enable/disable SlotVisualizer per variant
- [ ] API endpoint: `PATCH /api/groups/:id { show_inventory_visual: boolean }`
- [ ] Dashboard respects setting: Only show SlotVisualizer if flag = true
- [ ] Fallback: SlotBadge always shown (compact alternative)

#### Group Name & Variant Dynamic Rendering (Requested)
**Planned Implementation:**
- [ ] Fetch variant metadata from `/api/dashboard/inventory` with group names
- [ ] SlotVisualizer `<Component` label prop for custom display title
- [ ] Show: "YouTube Premium #01", "Spotify Premium - Profile 1", etc.
- [ ] Component enhancement: Add optional title/subtitle above dot grid

---

### Technology Stack (Finalized)
- **Frontend:** Next.js 16.1.6 (App Router), TypeScript, Tailwind CSS v4
- **UI Library:** shadcn/ui v3.8.5 (Card, Button, etc.)
- **Charts:** Recharts (bar, line, pie)
- **Data Fetching:** TanStack Query (caching, real-time)
- **Tables:** TanStack Table (sort, filter, pagination)
- **State:** Zustand (lightweight UI state)
- **Icons:** Lucide React
- **Fonts:** Geist (Google Fonts) + Inter (premium)

### Database Schema (Updated)
**Groups Table (228 records)**
- `id`, `subscription` (group name), `code`, `email`, `password`, `max_slots`, `created_at`
- **NEW:** `show_inventory_visual` (boolean, default true) - for enable/disable
- **Status:** All 228 groups migrated, tested, verified

### Files Created/Modified This Session
1. ✅ `src/app/globals.css` - Fixed from @layer issues, plain CSS typography
2. ✅ `src/app/layout.tsx` - Inter font variable + gradient background
3. ✅ `src/lib/colors.ts` - Status color utility system (existing)
4. ✅ `src/components/ui/skeleton-loader.tsx` - Loading components (existing)
5. ✅ `src/components/ui/slot-visualizer.tsx` - Bus seat model (existing, Phase 2)
6. ✅ `src/app/dashboard/page.tsx` - Refactored with colors + skeletons
7. ⏳ Dynamic enable/disable (PENDING - Phase 3)

### Build Status
- ✅ **CSS Build:** FIXED - No more `text-h1` unknown utility errors
- ✅ **Dev Server:** Running successfully on localhost:3000
- ✅ **Dashboard:** Accessible at /dashboard with premium styling
- ✅ **No console errors:** All imports resolving correctly


1. digilife-service.js → Added debug logging to detectProductFromMessage
2. reminder-service.js → Fixed WhatsApp request format from {jid, message} to {to, text}
3. digilife-service.js → Added smart filters to skip short/ambiguous messages
4. digilife-service.js → Added new/renewal detection using Column F=G logic
5. digilife-service.js → Added product codes for YouTube, Spotify, Canva, Disney+
6. digilife-service.js → Template now shows "Subscription" vs "Extended" based on customer type

### Admin Commands
**Payment Confirmation (Works for both NEW & RENEWAL):**
```
/pay 628xxx product-code
```

**Product Codes:**
- Netflix: `netflix-tv-1m/3m/6m/12m`, `netflix-nontv-1m/3m/6m/12m`
- YouTube Premium: `youtube-premium-1m/3m/6m/12m`
- Spotify: `spotify-1m/3m/6m/12m`
- Canva: `canva-1m/3m/6m/12m`
- Disney+: `disney-1m/3m/6m/12m`
- Microsoft 365: `microsoft-1m/3m/6m/12m`
- Apple Music: `apple-1m/3m/6m/12m`
- HBO GO Max: `hbo-1m/3m/6m/12m`
- Prime Video: `prime-1m/3m/6m/12m`
- CapCut Pro: `capcut-1m/3m/6m/12m`

**Example - New Customer:**
```
/pay 6285250941721 youtube-premium-12m
```
→ Bot sends: "Subscription *A Year*" (new customer)

**Example - Renewal:**
```
/pay 628123123055 netflix-tv-3m
```
→ Bot sends: "Extended *3 Months*" (renewal)

### Notification Message Formats

**⚠️ CRITICAL: Each product has specific format requirements!**

#### 1. SPOTIFY PREMIUM (Special Format)
- Uses profile name from Group sheet Column E (NOT customer email)
- Column E for Spotify: Contains ONLY profile name (no PIN)

**Template:**
```
*🎧#Spotify Premium 20*

User : *Citra Audrey Wanderlust*

Extended *6 Months*
Exp Date : *17 Aug 2026*
```

**Data Source:**
- Profile name: `Group.E` (groupPassword variable)
- Emoji: 🎧
- Duration: From PRODUCT_CODES
- Exp Date: Calculated from end_membership + months

---

#### 2. NETFLIX (Sharing Account)

**Netflix NON TV:**
```
*❌📺#Netflix Premium UHD-7. Friends*
❌📺 *(NON TV)*

Username : hary4di@gmail.com
Password : nP5-T4m

Profil : *AYU*
PIN : 8888

Extended *3 Months*
Exp Date : *29 Apr 2026*
```

**Netflix SHARED TV:**
```
*✅📺#Netflix Premium UHD-8. Narcos*
✅📺 *(SHARED TV)*

Username : suhary4di@gmail.com
Password : M3L-riM

Profil : *DOEL*
PIN : 2025

Extended *A Month*
Exp Date : *17 Mar 2026*
```

**Data Source:**
- Username: `Group.D` (groupEmail)
- Password: `Group.E` (groupPassword)
- Profil: `Customer.E` parsed (customer.profil_pin)
- PIN: `Customer.E` parsed (customer.profil_pin)
- Emoji: ❌📺 for NON TV, ✅📺 for SHARED TV
- Detection: Check if subscription name contains "SHARED" keyword

---

#### 3. DISNEY+ HOTSTAR (Login Number Format)
- Uses phone number from Group sheet Column D
- OTP-based login (no password shown)

**Template:**
```
*🏰#Disney+ Hotstar Group 09*

Login Number : *0851-5722-4505*
_OTP by Request_

Profil : *TRIPOMO*

Extended *6 Months*
Exp Date : *12 Aug 2026*
```

**Data Source:**
- Login Number: `Group.D` (groupEmail variable, contains phone number)
- Profil: `Customer.E` parsed (customer.profil_pin)
- Emoji: 🏰
- Static text: "_OTP by Request_"

---

#### 4. FAMILY ACCOUNTS (Simple Format)
**Products:** YouTube Premium, Canva Pro, Microsoft 365, Apple Music, CapCut Pro

**Template:**
```
*🎬#YouTube Premium Family 05*

user : customer@gmail.com

Subscription *A Year*
Exp Date : *22 Feb 2027*
```

**Data Source:**
- User email: `Customer.P` (customerEmail variable)
- Emoji: 🎬 YouTube, 🎨 Canva, 💼 Microsoft, 🎵 Apple Music, ✂️ CapCut
- Duration & Exp Date: Calculated

**Description:** 
Family accounts don't share login credentials. Customer uses own email to be invited to family group. Admin invites manually after payment confirmed.

---

#### 5. HBO GO MAX & PRIME VIDEO (Sharing Format)

**Template:**
```
*HBO GO Max*
🎭 *(Sharing)*

Username : hbo@account.com
Password : pass789

Profil : *Dedi*
PIN : 9012

Extended *A Month*
Exp Date : *22 Mar 2026*
```

**Data Source:**
- Username: `Group.D` (groupEmail)
- Password: `Group.E` (groupPassword)
- Profil: `Customer.E` parsed
- PIN: `Customer.E` parsed
- Emoji: 🎭 for HBO, 📺 for Prime Video

---

### Product Detection Logic

**In `processPaymentConfirmation` function:**

1. **Spotify** → Check `produkUpper.includes('SPOTIFY')`
   - Use `groupPassword` as profile name (from Group.E)
   - Format: `User : *ProfileName*`

2. **Disney+** → Check `produkUpper.includes('DISNEY')`
   - Use `groupEmail` as login number (from Group.D)
   - Show "_OTP by Request_"
   - Show profil only (no PIN)

3. **Netflix** → Check `produkUpper.includes('NETFLIX')`
   - Check subscription name for "SHARED" keyword
   - Emoji: ❌📺 (NON TV) or ✅📺 (SHARED TV)
   - Full credentials: username, password, profil, PIN

4. **HBO/Prime** → Check `produkUpper.includes('HBO')` or `'PRIME'`
   - Traditional sharing format
   - Show: username, password, profil, PIN

5. **Family Products** → YouTube, Canva, Microsoft, Apple Music, CapCut
   - Simple format: emoji + subscription name
   - Show customer email only
   - No credentials (admin invites manually)

---
**Last Updated:** 2026-02-22 13:57 WIB
