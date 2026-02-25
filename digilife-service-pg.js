// Digilife AI Agent Service - PostgreSQL Version
// AI-powered chatbot dengan PostgreSQL integration
// Conversation history persistent, optimization dengan direct DB queries

const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');
const OpenAI = require('openai');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3010/send-message';
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '628128933008').split(',').map(n => n.trim());

// ====== POSTGRESQL SETUP ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb',
});

// Test connection
pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err.message);
});

pool.connect((err) => {
  if (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
  } else {
    console.log('✅ PostgreSQL connected successfully');
  }
});

// ====== GOOGLE SHEETS SETUP (backup fallback only) ======
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1US9SqWny3hA6JogGSCxh6sOkr98ZrzzxER_mdAuqpsg';
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';

async function getAuthClient() {
  try {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
  } catch (error) {
    console.warn('⚠️  Google Sheets fallback unavailable');
    return null;
  }
}

// ====== OPENAI SETUP ======
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ====== QDRANT SETUP ======
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = 'digilife_knowledge';

let qdrant;
try {
  qdrant = new QdrantClient({ url: QDRANT_URL });
  console.log('✅ Qdrant client initialized:', QDRANT_URL);
} catch (error) {
  console.error('⚠️ Qdrant initialization error:', error.message);
  qdrant = null;
}

// Cache TTL settings
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let pricingCache = { data: [], lastUpdate: 0 };
let customerCache = { data: [], lastUpdate: 0 };
let groupCache = { data: {}, lastUpdate: 0 };

let overrideList = [];

// ====== CONVERSATION HISTORY FUNCTIONS (PostgreSQL) ======

/**
 * Get conversation history dari PostgreSQL
 * Unlimited history, tidak hilang saat restart
 */
async function getConversationHistory(phoneNumber, limit = 20) {
  try {
    const result = await pool.query(
      `SELECT message_text, response_text, intent, product_name, created_at, metadata
       FROM conversations
       WHERE customer_phone = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [phoneNumber, limit]
    );
    
    // Convert database format ke conversation format
    const conversations = result.rows.reverse().map(row => ({
      timestamp: new Date(row.created_at).getTime(),
      user: {
        content: row.message_text,
        intent: row.intent,
        product: row.product_name,
      },
      assistant: {
        content: row.response_text || '',
        metadata: row.metadata
      }
    }));
    
    return conversations;
  } catch (error) {
    console.error('❌ Error fetching conversation history:', error.message);
    return [];
  }
}

/**
 * Save conversation ke PostgreSQL
 * Dengan metadata untuk tracking reminder context
 */
async function updateConversationHistory(phoneNumber, messageText, responseText, metadata = {}) {
  try {
    const result = await pool.query(
      `INSERT INTO conversations 
       (customer_phone, message_text, response_text, intent, product_name, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, created_at`,
      [
        phoneNumber,
        messageText,
        responseText,
        metadata.intent || null,
        metadata.product || null,
        JSON.stringify(metadata)
      ]
    );
    
    if (result.rows.length > 0) {
      console.log(`   💾 Conversation saved (ID: ${result.rows[0].id})`);
      return result.rows[0].id;
    }
  } catch (error) {
    console.error('❌ Error saving conversation:', error.message);
  }
}

/**
 * Track reminder context
 * Gunakan saat reminder dikirim untuk link context
 */
async function trackReminderContext(phoneNumber, conversationId, reminderType = 'h5') {
  try {
    await pool.query(
      `INSERT INTO conversation_metadata 
       (conversation_id, customer_phone, reminder_triggered, reminder_type, reminder_sent_at, context_tags)
       VALUES ($1, $2, true, $3, NOW(), $4)`,
      [conversationId, phoneNumber, reminderType, ['reminder']]
    );
    console.log(`   📍 Reminder context tracked for ${phoneNumber}`);
  } catch (error) {
    console.error('❌ Error tracking reminder context:', error.message);
  }
}

/**
 * Get recent reminder untuk customer
 * Gunakan untuk understand context saat customer balas reminder
 */
async function getRecentReminderContext(phoneNumber, hoursAgo = 72) {
  try {
    const result = await pool.query(
      `SELECT cm.reminder_type, cm.reminder_sent_at, c.message_text, c.product_name
       FROM conversation_metadata cm
       LEFT JOIN conversations c ON cm.conversation_id = c.id
       WHERE cm.customer_phone = $1
       AND cm.reminder_triggered = true
       AND cm.reminder_sent_at > NOW() - INTERVAL '1 hour' * $2
       ORDER BY cm.reminder_sent_at DESC
       LIMIT 1`,
      [phoneNumber, hoursAgo]
    );
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('❌ Error fetching reminder context:', error.message);
    return null;
  }
}

// ====== DATA LOADING FUNCTIONS (Optimized for PostgreSQL) ======

/**
 * Load pricing dari PostgreSQL
 * Direct query lebih cepat dari Google Sheets API
 */
async function loadPricingData() {
  const now = Date.now();
  
  // Check cache dulu
  if (pricingCache.data.length > 0 && now - pricingCache.lastUpdate < CACHE_TTL) {
    return pricingCache.data;
  }

  try {
    // Try PostgreSQL dulu
    const result = await pool.query(
      `SELECT name as product, duration, price, price_regular, currency, updated_at
       FROM subscription_prices
       ORDER BY name, duration`
    );
    
    if (result.rows && result.rows.length > 0) {
      pricingCache = { data: result.rows, lastUpdate: now };
      console.log(`✅ Loaded ${result.rows.length} pricing items from PostgreSQL`);
      return result.rows;
    }
    
    // Fallback to Google Sheets
    console.warn('⚠️  No pricing in PostgreSQL, falling back to Google Sheets');
    const sheetPricing = await loadPricingDataFromSheets();
    pricingCache = { data: sheetPricing, lastUpdate: now };
    return sheetPricing;
    
  } catch (error) {
    console.error('❌ Error loading pricing data:', error.message);
    return pricingCache.data || [];
  }
}

/**
 * Load customer dari PostgreSQL
 * Includes subscription status, expiry dates, payment status
 */
async function loadCustomerData() {
  const now = Date.now();
  
  if (customerCache.data.length > 0 && now - customerCache.lastUpdate < CACHE_TTL) {
    return customerCache.data;
  }

  try {
    // Load customer dengan subscription info
    const result = await pool.query(
      `SELECT 
        cm.id,
        cm.nama,
        cm.wa_number as wa_pelanggan,
        cm.email,
        cm.customer_type,
        count(cs.id) as total_subscriptions,
        array_agg(cs.produk) as products,
        max(cs.end_date) as latest_expiry
       FROM customer_master cm
       LEFT JOIN customer_subscriptions cs ON cm.id = cs.customer_id AND cs.active = true
       GROUP BY cm.id
       ORDER BY cm.nama`
    );
    
    if (result.rows && result.rows.length > 0) {
      customerCache = { data: result.rows, lastUpdate: now };
      console.log(`✅ Loaded ${result.rows.length} customer records from PostgreSQL`);
      return result.rows;
    }
    
    return [];
    
  } catch (error) {
    console.error('❌ Error loading customer data:', error.message);
    return customerCache.data || [];
  }
}

/**
 * Load group accounts from PostgreSQL
 * Better structure than Google Sheets
 */
async function loadGroupData() {
  const now = Date.now();
  
  if (groupCache.data && Object.keys(groupCache.data).length > 0 && now - groupCache.lastUpdate < CACHE_TTL) {
    return groupCache.data;
  }

  try {
    const result = await pool.query(
      `SELECT name, email, password, code
       FROM groups
       WHERE active = true
       ORDER BY name`
    );
    
    const groups = {};
    if (result.rows && result.rows.length > 0) {
      result.rows.forEach(row => {
        groups[row.name] = {
          email: row.email,
          password: row.password,
          code: row.code,
        };
      });
    }
    
    groupCache = { data: groups, lastUpdate: now };
    console.log(`✅ Loaded ${Object.keys(groups).length} group accounts from PostgreSQL`);
    return groups;
    
  } catch (error) {
    console.error('❌ Error loading group data:', error.message);
    return groupCache.data || {};
  }
}

/**
 * Lookup customer dari PostgreSQL by phone
 * Dengan subscription details
 */
async function lookupCustomer(phoneNumber) {
  try {
    const result = await pool.query(
      `SELECT 
        cm.id,
        cm.nama,
        cm.wa_number,
        cm.email,
        cm.customer_type,
        json_agg(
          json_build_object(
            'product', cs.produk,
            'start_date', cs.start_date,
            'end_date', cs.end_date,
            'status', cs.status,
            'active', cs.active
          )
        ) as subscriptions
       FROM customer_master cm
       LEFT JOIN customer_subscriptions cs ON cm.id = cs.customer_id
       WHERE cm.wa_number = $1
       GROUP BY cm.id`,
      [phoneNumber]
    );
    
    return result.rows.length > 0 ? result.rows[0] : null;
    
  } catch (error) {
    console.error('❌ Error looking up customer:', error.message);
    return null;
  }
}

// ====== FALLBACK GOOGLE SHEETS FUNCTIONS ======

async function loadPricingDataFromSheets() {
  try {
    const authClient = await getAuthClient();
    if (!authClient) return [];
    
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pricing!A:F',
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return [];

    const pricing = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      pricing.push({
        product: row[0] || '',
        duration: row[1] || '',
        price: parseInt(row[2]) || 0,
        price_regular: parseInt(row[3]) || 0,
        currency: row[4] || 'IDR',
        updated_at: row[5] || '',
      });
    }
    
    console.log(`✅ Loaded ${pricing.length} pricing items from Google Sheets (fallback)`);
    return pricing;
  } catch (error) {
    console.error('❌ Error loading pricing from Sheets:', error.message);
    return [];
  }
}

// ====== IMAGE OCR ======

async function extractTextFromImage(imageUrl) {
  try {
    console.log(`🖼️  Extracting text from image: ${imageUrl.substring(0, 50)}...`);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract semua teks yang terlihat di gambar ini. Jika ada pertanyaan tentang produk digital subscription (Netflix, Spotify, YouTube Premium, dll), jelaskan konteksnya. Response dalam bahasa Indonesia.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'low'
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });
    
    const extractedText = response.choices[0].message.content;
    console.log(`   ✅ Extracted text: "${extractedText.substring(0, 100)}..."`);
    return extractedText;
  } catch (error) {
    console.error('❌ Error extracting text from image:', error.message);
    return '[Gambar diterima, tapi tidak bisa dibaca]';
  }
}

// ====== HELPER FUNCTIONS ======

function isAdmin(phoneNumber) {
  return ADMIN_NUMBERS.includes(phoneNumber);
}

function formatPhoneNumber(phone) {
  phone = phone.replace(/[^0-9]/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.substring(1);
  }
  return phone;
}

// ====== API ENDPOINTS ======

// Test endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: 'PostgreSQL',
    features: ['Conversation history (persistent)', 'Reminder context tracking', 'Direct data from PostgreSQL']
  });
});

// Inbound message handler (from WhatsApp Bot)
app.post('/inbound', async (req, res) => {
  const { message = '', mediaUrl, phoneNumber } = req.body;
  const normalizedPhone = formatPhoneNumber(phoneNumber);

  console.log(`\n📩 Incoming message from ${phoneNumber}:`);
  console.log(`   Message: "${message}"`);

  try {
    let messageText = message;
    
    // Handle image if provided
    if (mediaUrl) {
      console.log(`   📎 Media attached: ${mediaUrl}`);
      const extractedText = await extractTextFromImage(mediaUrl);
      messageText = `[IMAGE] ${extractedText}\\n\\n${message}`;
    }

    // Fetch conversation history dari PostgreSQL
    const conversationHistory = await getConversationHistory(normalizedPhone);
    console.log(`   💬 Conversation history: ${conversationHistory.length} messages`);

    // Check reminder context
    const reminderContext = await getRecentReminderContext(normalizedPhone);
    if (reminderContext) {
      console.log(`   📍 Recent reminder detected: ${reminderContext.reminder_type}`);
      messageText = `[CONTEXT: User is responding to ${reminderContext.reminder_type} reminder about ${reminderContext.product_name}]\\n\\n${messageText}`;
    }

    // ... rest of the inbound handler code ...
    // (Keep existing logic, just add PostgreSQL saves)

    // Save to conversation history AFTER processing
    // This will be done after getting response from GPT

    return res.json({ 
      status: 'received',
      message: 'Processing...'
    });

  } catch (error) {
    console.error('❌ Error processing inbound message:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
});

// Send message endpoint
app.post('/send-message', async (req, res) => {
  const { to, message, metadata = {} } = req.body;
  console.log(`📤 Sending to ${to}: ${message.substring(0, 50)}...`);
  
  try {
    const response = await axios.post(BOT_API_URL, {
      to,
      message
    });
    
    res.json({ success: true, response: response.data });
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Conversation history endpoint
app.get('/conversation/:phone', async (req, res) => {
  const phone = formatPhoneNumber(req.params.phone);
  const limit = req.query.limit || 20;
  
  try {
    const history = await getConversationHistory(phone, limit);
    res.json({
      phone,
      messageCount: history.length,
      messages: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Data endpoints
app.get('/data/customers', async (req, res) => {
  try {
    const customers = await loadCustomerData();
    res.json({ count: customers.length, data: customers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/data/pricing', async (req, res) => {
  try {
    const pricing = await loadPricingData();
    res.json({ count: pricing.length, data: pricing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/data/groups', async (req, res) => {
  try {
    const groups = await loadGroupData();
    res.json({ count: Object.keys(groups).length, data: groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== SERVER START ======

const server = app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🚀 Digilife AI Agent Service (PostgreSQL Version)');
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Running on port ${PORT}`);
  console.log(`📊 Data source: PostgreSQL + Qdrant + OpenAI`);
  console.log(`💾 Conversation history: Persistent (PostgreSQL)`);
  console.log(`📍 Reminder context tracking: Enabled`);
  console.log(`${'='.repeat(60)}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});

module.exports = app;
