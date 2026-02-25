# Digilife AI Agent

AI-powered chatbot untuk menjawab pertanyaan seputar harga produk digital subscription via WhatsApp.

## Features

- ✅ Integrasi dengan WhatsApp via Baileys
- ✅ AI-powered intent detection (OpenAI GPT-4o-mini)
- ✅ Automatic pricing lookup dari Google Sheets
- ✅ Customer validation
- ✅ Multi-language support (auto-detect)
- ✅ Cache mechanism untuk performa optimal
- ✅ Format harga dengan strikethrough untuk promo

## Architecture

```
WA Message → bot-1 (Baileys) → Digilife Service (AI Agent) → bot-1 → WA Reply
                                      ↓
                            Google Sheets (Pricing + Customer)
                                      ↓
                            OpenAI GPT-4o-mini (LLM)
```

## Setup

### 1. Install Dependencies

```bash
cd ~/Digilife
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` dan isi dengan kredensial:

```bash
cp .env.example .env
nano .env
```

Isi nilai:
- `OPENAI_API_KEY`: API key dari OpenAI
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Email service account
- `GOOGLE_PRIVATE_KEY`: Private key dari service account JSON

### 3. Upload Google Credentials

Upload file `google-credentials.json` ke folder `~/Digilife/`

### 4. Setup Google Sheets

Pastikan Google Sheets sudah:
- Di-share ke service account email
- Memiliki sheet "Pricing" dengan kolom:
  - product
  - duration
  - price
  - price_non_promo
  - currency
  - updated_at
- Memiliki sheet "Customer" dengan kolom:
  - No
  - NAMA
  - PRODUK
  - WA Pelanggan
  - Status payment
  - END OF MEMBERSHIP

### 5. Sync Kontak ke Google Sheets (Opsional)

Upload file VCF sebagai `contacts.vcf` dan jalankan:

```bash
node parse-vcf-to-sheet.js
```

### 6. Update bot-1 Webhook URL

Edit `~/Baileys/bot-1/server.js`, ubah webhook URL dari n8n ke Digilife:

```javascript
const n8nWebhookUrl = 'http://localhost:3001/inbound';
```

Restart bot-1:

```bash
pm2 restart bot-1
```

### 7. Start Digilife Service

```bash
npm start
```

Atau dengan PM2:

```bash
pm2 start digilife-service.js --name digilife
pm2 save
```

## Testing

### Health Check

```bash
curl http://localhost:3001/health
```

### Test Inbound (Manual)

```bash
curl -X POST http://localhost:3001/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "senderJid": "6281234567890@s.whatsapp.net",
    "senderName": "Test User",
    "chatJid": "6281234567890@s.whatsapp.net",
    "text": "Berapa harga Netflix 3 bulan?",
    "isGroup": false
  }'
```

## Pricing Data Format

Format untuk sheet "Pricing":

| product | duration | price | price_non_promo | currency | updated_at |
|---------|----------|-------|-----------------|----------|------------|
| Netflix Premium Reguler | 1 bulan | 65000 | 76000 | IDR | 2026-02-22 |
| Netflix Premium Reguler | 3 bulan | 195000 | 230000 | IDR | 2026-02-22 |
| YouTube Premium | 1 bulan | 55000 | 76000 | IDR | 2026-02-22 |

**Catatan**: `price_non_promo` digunakan untuk format strikethrough ~harga~ di response WA.

## Logs

Lihat logs dengan PM2:

```bash
pm2 logs digilife
```

## Troubleshooting

### Error: Cannot find module 'xxx'

```bash
cd ~/Digilife
npm install
```

### Error: Google Sheets API

Pastikan:
1. Service account email sudah di-share ke spreadsheet
2. GOOGLE_PRIVATE_KEY di .env menggunakan format dengan `\n` (escaped newline)

### Bot tidak merespon

Cek:
1. PM2 status: `pm2 list`
2. Logs bot-1: `pm2 logs bot-1`
3. Logs digilife: `pm2 logs digilife`
4. Webhook URL di bot-1 sudah benar

## License

ISC
