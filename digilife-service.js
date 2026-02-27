// Digilife AI Agent Service
// AI-powered chatbot untuk menjawab pertanyaan produk digital subscription

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');
const NodeCache = require('node-cache');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// WhatsApp Provider Adapter (supports Fonnte via local gateway AND GOWA)
// Switch provider: set WHATSAPP_PROVIDER='gowa' in .env, or via /api/admin/switch-provider
const waAdapter = require('./gowa-implementation/adapter/whatsapp-adapter');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3010/send-message'; // Fixed: Bot runs on 3010, not 3000

// Initialize WhatsApp adapter singleton
waAdapter.initializeAdapter();

/**
 * Central function to send WhatsApp text messages.
 * Routes through either Fonnte gateway (localhost:3010) or GOWA API (localhost:3001)
 * depending on WHATSAPP_PROVIDER env var. Can be switched at runtime without restart.
 * @param {string} chatId - WhatsApp JID e.g. '628128933008@s.whatsapp.net'
 * @param {string} text   - Message text to send
 */
async function sendWAMessage(chatId, text) {
  return await waAdapter.sendMessage(chatId, text);
}

// Admin config untuk payment confirmation
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '628128933008').split(',').map(n => n.trim());

// OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Google Gemini Setup untuk Vision OCR
const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
let gemini = null;
if (geminiApiKey) {
  try {
    const googleAI = new GoogleGenerativeAI(geminiApiKey);
    gemini = googleAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    console.log('✅ Google Gemini initialized for Vision OCR (gemini-2.5-flash)');
  } catch (error) {
    console.error('⚠️ Gemini initialization error:', error.message);
    gemini = null;
  }
}

// Qdrant Setup untuk Vector DB
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = 'digilife_knowledge';

// SerpAPI Setup untuk web search
const SERPAPI_KEY = process.env.SERPAPI_KEY || '73c6ddd39e29710be693f3487595318d872b0ea6cebd4e34e399dfd9a14f9994';

let qdrant;
try {
  qdrant = new QdrantClient({ url: QDRANT_URL });
  console.log('✅ Qdrant client initialized:', QDRANT_URL);
} catch (error) {
  console.error('⚠️ Qdrant initialization error:', error.message);
  qdrant = null;
}

// Cache untuk data Pricing, Customer, dan Group
let pricingCache = { data: [], lastUpdate: 0 };
let customerCache = { data: [], lastUpdate: 0 };
let groupCache = { data: {}, lastUpdate: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

// Override List - nomor yang di-skip (tidak akan respond)
// Format: array of {phone, name}
let overrideList = [];

// Conversation History Cache (per user, 30 menit TTL) - fallback only
const conversationCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });
const MAX_HISTORY = 10; // Simpan last 10 messages per user

// ====== POSTGRESQL - Persistent conversation history + customer name ======
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb',
});

pgPool.connect((err) => {
  if (err) console.error('⚠️  PostgreSQL history unavailable:', err.message);
  else console.log('✅ PostgreSQL connected (history + customer lookup)');
});

// Lookup customer name dari DB by WA number
async function lookupCustomerName(phoneNumber) {
  try {
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    const result = await pgPool.query(
      `SELECT nama FROM customer_master WHERE REGEXP_REPLACE(wa_pelanggan, '[^0-9]', '', 'g') = $1
       UNION
       SELECT nama FROM customer_subscriptions WHERE REGEXP_REPLACE(wa_pelanggan, '[^0-9]', '', 'g') = $1
       LIMIT 1`,
      [clean]
    );
    return result.rows.length > 0 ? result.rows[0].nama : null;
  } catch (e) {
    return null;
  }
}

// Helper: Extract first name saja dari full name
function getFirstName(fullName) {
  if (!fullName) return 'ka';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || 'ka';
}

// Helper: Check apakah customer punya langganan produk ini dan akan expiry soon
async function checkRenewalReminder(phoneNumber, productName) {
  try {
    if (!productName) return null;
    
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    const result = await pgPool.query(
      `SELECT nama, end_membership FROM customer_subscriptions 
       WHERE wa_pelanggan = $1 AND LOWER(produk) LIKE LOWER($2) AND status_payment = 'ACTIVE' 
       LIMIT 1`,
      [clean, `%${productName}%`]
    );
    
    if (!result.rows[0]) return null;
    
    const { nama, end_membership } = result.rows[0];
    if (!end_membership) return null;
    
    const today = new Date();
    const endDate = new Date(end_membership);
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    
    // Reminder hanya jika <= 7 hari lagi
    if (daysLeft > 7 || daysLeft < 0) return null;
    
    const firstName = getFirstName(nama);
    if (daysLeft <= 0) {
      return `⚠️ *${firstName}*, langganan ${productName}-mu sudah expired! Mau perpanjang?\n\n`;
    } else if (daysLeft === 1) {
      return `⚠️ *${firstName}*, langganan ${productName}-mu akan expired besok! Mau perpanjang sekarang?\n\n`;
    } else {
      return `💡 *${firstName}*, langganan ${productName}-mu akan expired ${daysLeft} hari lagi. Mungkin mau perpanjang sekalian?\n\n`;
    }
  } catch (e) {
    console.error('❌ checkRenewalReminder error:', e.message);
    return null;
  }
}

// Helper: Get all subscriptions untuk satu customer
async function getCustomerSubscriptions(phoneNumber) {
  try {
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    const result = await pgPool.query(
      `SELECT produk, end_membership, status_payment, slot FROM customer_subscriptions 
       WHERE wa_pelanggan = $1 AND status_payment IN ('ACTIVE', 'PENDING')
       ORDER BY end_membership DESC`,
      [clean]
    );
    
    if (!result.rows || result.rows.length === 0) {
      return null;
    }
    
    // Format setiap subscription
    const subscriptions = result.rows.map(row => {
      const endDate = new Date(row.end_membership);
      const today = new Date();
      const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
      
      let statusEmoji = '✅';
      let statusText = 'AKTIF';
      if (row.status_payment === 'PENDING') {
        statusEmoji = '⏳';
        statusText = 'MENUNGGU PEMBAYARAN';
      } else if (daysLeft <= 7 && daysLeft > 0) {
        statusEmoji = '⚠️';
        statusText = `EXPIRED ${daysLeft} HARI LAGI`;
      } else if (daysLeft <= 0) {
        statusEmoji = '❌';
        statusText = 'EXPIRED';
      }
      
      return {
        product: row.produk,
        expiry: endDate.toLocaleDateString('id-ID'),
        daysLeft,
        status: statusText,
        statusEmoji,
        slot: row.slot || null,
      };
    });
    
    return subscriptions;
  } catch (e) {
    console.error('❌ getCustomerSubscriptions error:', e.message);
    return null;
  }
}

// Helper: Analyze payment proof image (detect transfer screenshot)
async function analyzePaymentProof(imageUrl) {
  try {
    console.log(`🔍 Analyzing payment proof with Gemini Vision...`);
    
    if (!gemini) {
      console.log('   ⚠️ Gemini not available, using fallback');
      return 'bukti pembayaran';
    }
    
    // Download image dan convert ke base64
    // Download image dari localhost → base64 (Gemini API tidak bisa akses localhost URL)
    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageData = Buffer.from(imgResponse.data).toString('base64');
    const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';

    // Gemini Vision — text dan inlineData HARUS jadi dua parts terpisah
    const result = await gemini.generateContent([
      {
        text: `Analisa screenshot ini dengan DETAIL. Apakah ini bukti transfer/pembayaran bank?\nJika YA, ekstrak SEMUA info: nama bank, nominal/amount, nomor rekening tujuan, nama penerima, waktu transfer, kode/referensi transfer, dan PRODUK YANG DIBELI (jika terlihat: Netflix, Spotify, YouTube, Amazon Prime, Disney, etc).\nJika TIDAK, jawab "bukan bukti pembayaran".\nFormat response sebagai JSON dengan key: is_payment_proof, bank_name, amount, account_number, recipient_name, transaction_time, product, status.`
      },
      {
        inlineData: {
          mimeType: mimeType,
          data: imageData
        }
      }
    ]);
    
    const analysis = result.response.text();
    console.log(`   ✅ Proof analysis: ${analysis.substring(0, 100)}...`);
    return analysis;
  } catch (e) {
    console.error('⚠️ Error analyzing payment proof:', e.message);
    return 'bukti pembayaran';
  }
}

// Get conversation history dari PostgreSQL
async function getConversationHistoryPG(phoneNumber, limit = 20) {
  try {
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    const result = await pgPool.query(
      `SELECT message_type, message_text FROM conversations
       WHERE wa_number = $1
       ORDER BY created_at DESC LIMIT $2`,
      [clean, limit]
    );
    // Convert to [{role,content}] format, oldest first
    return result.rows.reverse().map(r => ({
      role: r.message_type === 'incoming' ? 'user' : 'assistant',
      content: r.message_text,
    }));
  } catch (e) {
    console.error('❌ getConversationHistoryPG error:', e.message);
    return conversationCache.get(phoneNumber) || [];
  }
}

// Save conversation ke PostgreSQL
async function saveConversationPG(phoneNumber, message, response) {
  try {
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    // Insert user message (incoming) dan bot response (outgoing) sebagai 2 rows terpisah
    await pgPool.query(
      `INSERT INTO conversations (wa_number, message_type, message_text, is_handled_by_bot)
       VALUES ($1, 'incoming', $2, false), ($1, 'outgoing', $3, true)`,
      [clean, message, response]
    );
  } catch (e) {
    console.error('❌ saveConversationPG error:', e.message);
    // Fallback: save to NodeCache
    updateConversationHistory(phoneNumber, 'user', message);
    updateConversationHistory(phoneNumber, 'assistant', response);
  }
}

// ====== SMART RESPONSE FILTERS (Anti-Annoying Bot) ======

// 1. Detect apakah message terlalu pendek dan tidak perlu response
function shouldSkipShortMessage(messageText, conversationHistory = []) {
  const msg = messageText.toLowerCase().trim();
  const msgLength = messageText.trim().length;
  
  // Support keywords yang HARUS dijawab meskipun pendek
  const supportKeywords = ['otp', 'error', 'problem', 'gagal', 'tidak bisa', 'masalah', 'bantuan', 'gimana', 'apa', 'caranya', 'bagaimana'];
  const hasSupport = supportKeywords.some(kw => msg.includes(kw));
  
  // Jika < 5 karakter dan TIDAK ada support keywords → SKIP
  if (msgLength < 5 && !hasSupport) {
    console.log(`⏸️  SKIP: Short message <5 chars without support context: "${messageText}"`);
    return true;
  }
  
  // Jika hanya short acknowledgment ("ok", "oke", "tq", "mantap", "5", "baik") → SKIP
  const silenceKeywords = ['ok', 'oke', 'tq', 'ok', 'ty', 'tyy', 'mantap', 'baik', 'siap', 'iya', 'yyy', 'yy', 'ya'];
  const isAcknowledgment = silenceKeywords.includes(msg);
  const isOnlyNumbers = /^[\d\s.,]+$/.test(messageText);
  
  if ((isAcknowledgment || isOnlyNumbers) && msgLength < 10) {
    console.log(`⏸️  SKIP: Acknowledgment-only message: "${messageText}"`);
    return true;
  }
  
  return false;
}

// 2. Detect apakah bot sudah tanya clarification di messages terakhir
function detectPreviousClarification(conversationHistory = []) {
  if (!conversationHistory || conversationHistory.length < 2) return false;
  
  // Ambil 2 message terakhir (bot responses) 
  const recentBotMessages = conversationHistory
    .filter(m => m.role === 'assistant')
    .slice(-2)
    .map(m => m.content.toLowerCase());
  
  // Cek apakah bot sudah tanya apa/gimana/jelaskan di recent messages
  const clarificationPatterns = [
    'bisa dijelaskan', 'jelaskan', 'apakah ini tentang', 'yang mana', 'produk apa',
    'tanya tentang', 'maksudnya', 'sebenernya tentang apa', 'mau tanya tentang'
  ];
  
  const alreadyAsked = recentBotMessages.some(msg =>
    clarificationPatterns.some(pattern => msg.includes(pattern))
  );
  
  if (alreadyAsked) {
    console.log(`⚠️  WARNING: Already asked clarification in recent messages`);
    return true;
  }
  
  return false;
}

// 3. Detect excessive back-and-forth (3+ user messages <10chars in a row)
function detectConversationMomentum(conversationHistory = []) {
  if (!conversationHistory || conversationHistory.length < 6) return false;
  
  // Ambil last 3 user messages
  const recentUserMsgs = conversationHistory
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content.trim());
  
  if (recentUserMsgs.length < 3) return false;
  
  // Jika 3 pesan terakhir semuanya <10 chars → conversation momentum terganggu
  const allShort = recentUserMsgs.every(m => m.length < 10);
  
  if (allShort) {
    console.log(`⏳ MOMENTUM: 3 short messages in a row - user might be distracted`);
    return true;
  }
  
  return false;
}

// 4. Check product confidence dari conversation history
function calculateProductConfidence(messageText, conversationHistory = []) {
  const msg = messageText.toLowerCase();
  let confidence = 0;
  
  // 1. Product mentioned in CURRENT message (+40)
  const productKeywords = ['netflix', 'spotify', 'youtube', 'hbo', 'prime', 'disney', 'microsoft', 'canva', 'vpn', 'apple'];
  const mentionedInMsg = productKeywords.filter(p => msg.includes(p));
  if (mentionedInMsg.length > 0) {
    confidence += 40;
    console.log(`   ✓ Product in message: +40`);
  }
  
  // 2. Product mentioned in HISTORY (+30)
  if (conversationHistory && conversationHistory.length > 0) {
    const historyMsg = conversationHistory.map(m => m.content).join(' ').toLowerCase();
    const mentionedInHistory = productKeywords.filter(p => historyMsg.includes(p));
    if (mentionedInHistory.length > 0) {
      confidence += 30;
      console.log(`   ✓ Product in history: +30`);
    }
  }
  
  // 3. Support/Renewal keywords (+20)
  const contextKeywords = ['error', 'problem', 'tidak bisa', 'gimana', 'caranya', 'perpanjang', 'bayar', 'harga'];
  if (contextKeywords.some(kw => msg.includes(kw))) {
    confidence += 20;
    console.log(`   ✓ Context keywords: +20`);
  }
  
  // 4. Explicit intent in message (+10)
  if (msg.length > 20) {
    confidence += 10;
    console.log(`   ✓ Longer message: +10`);
  }
  
  return Math.min(confidence, 100);
}

// SMART FILTER 4: Detect vague questions and provide category overview instead of asking clarification
function detectVagueQuestion(messageText, conversationHistory = []) {
  const msg = messageText.toLowerCase().trim();
  
  // Very vague patterns that usually trigger annoying clarification
  const vaguePatterns = [
    /^mau tanya(?: dong)?$/i,
    /^tanya(?: dong)?$/i,
    /^ada apa aja\??$/i,
    /^ada promo\??$/i,
    /^promo apa\??$/i,
    /^lagi promo\??$/i,
    /^lagi ada promo\??$/i,
    /^produk apa aja\??$/i,
    /^apa aja\??$/i
  ];
  
  return vaguePatterns.some(pattern => pattern.test(msg));
}

// Helper function: Build category overview response
function buildCategoryOverview(customerName) {
  return `Halo ${customerName ? 'Ka ' + customerName : 'ka'}! 👋

Kita punya produk digital di kategori:

🎬 *Streaming:* Netflix, YouTube Premium, Disney+ Hotstar
🎵 *Music:* Spotify Premium, Apple Music
💼 *Productivity:* Microsoft 365, Canva Pro, Adobe
☁️ *Cloud Storage:* Google One, iCloud+

Mau tanya tentang produk yang mana? 😊`;
}

// Helper function: Build pricing response WITHOUT LLM (accurate & fast)
function buildPricingResponse(customerName, products, renewalReminder = null) {
  if (!products || products.length === 0) {
    return 'Maaf, produk yang ditanyakan tidak tersedia atau tidak ditemukan.';
  }

  let response = renewalReminder ? renewalReminder + '\n\n' : '';
  
  if (customerName) {
    response += `Ka ${customerName}, berikut harga produk yang tersedia:\n\n`;
  } else {
    response += `Halo! Berikut harga produk yang tersedia:\n\n`;
  }

  // Group by product name for better formatting
  const groupedByProduct = {};
  products.forEach(p => {
    if (!groupedByProduct[p.product]) {
      groupedByProduct[p.product] = [];
    }
    groupedByProduct[p.product].push(p);
  });

  Object.entries(groupedByProduct).forEach(([productName, items]) => {
    if (Object.keys(groupedByProduct).length > 1) {
      response += `*${productName}:*\n`;
    }
    
    items.forEach(item => {
      if (item.price_normal > 0 && item.price_normal > item.price) {
        // Ada promo
        response += `- ${item.duration}: ~Rp ${item.price_normal.toLocaleString('id-ID')}~ *Rp ${item.price.toLocaleString('id-ID')}*\n`;
      } else {
        // Harga reguler
        response += `- ${item.duration}: *Rp ${item.price.toLocaleString('id-ID')}*\n`;
      }
    });
    
    if (Object.keys(groupedByProduct).length > 1) {
      response += `\n`;
    }
  });

  response += `\nMau order atau info lebih lanjut? Hubungi admin ya! 😊`;
  
  return response;
}

// Fungsi untuk OCR gambar menggunakan GPT-4o-mini Vision
async function extractTextFromImage(imageUrl) {
  try {
    console.log(`🖼️  Extracting text from image: ${imageUrl.substring(0, 60)}...`);

    if (!gemini) {
      console.warn('⚠️ Gemini not available for text extraction');
      return '[Gambar diterima, tapi tidak bisa dibaca]';
    }

    // Download image dari localhost → base64 (Gemini API tidak bisa akses localhost URL)
    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageData = Buffer.from(imgResponse.data).toString('base64');
    const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';

    // Gemini Flash Vision — text dan inlineData HARUS jadi dua parts terpisah
    const result = await gemini.generateContent([
      {
        text: 'Extract semua teks yang terlihat di gambar ini. Jika ada informasi pembayaran/transfer, sebutkan: nominal, nama penerima, bank, nomor rekening. Jika ada pertanyaan tentang produk digital subscription (Netflix, Spotify, YouTube Premium, dll), jelaskan konteksnya. Response dalam bahasa Indonesia.'
      },
      {
        inlineData: {
          mimeType: mimeType,
          data: imageData
        }
      }
    ]);

    const extractedText = result.response.text();
    console.log(`   ✅ Extracted text: "${extractedText.substring(0, 100)}..."`);
    return extractedText;
  } catch (error) {
    console.error('❌ Error extracting text from image:', error.message);
    return '[Gambar diterima, tapi tidak bisa dibaca]';
  }
}

// Fungsi untuk load data dari PostgreSQL
async function loadPricingData() {
  const now = Date.now();
  if (pricingCache.data.length > 0 && now - pricingCache.lastUpdate < CACHE_TTL) {
    return pricingCache.data;
  }

  try {
    const result = await pgPool.query(
      `SELECT product, duration, price::numeric AS price, description
       FROM pricing
       WHERE is_active = true
       ORDER BY product, duration`
    );

    const pricing = result.rows.map(row => {
      // Parse harga normal dari kolom description (format: "Harga normal: 390000")
      const descMatch = row.description ? row.description.match(/Harga normal:\s*(\d+)/) : null;
      const priceNormal = descMatch ? parseInt(descMatch[1]) : 0;
      return {
        product:       row.product || '',
        duration:      row.duration || '',
        price:         Math.round(parseFloat(row.price)) || 0,
        price_normal:  priceNormal,   // harga sebelum diskon (0 = tidak ada diskon)
        currency:      'IDR',
      };
    });

    pricingCache = { data: pricing, lastUpdate: now };
    console.log(`✅ Loaded ${pricing.length} pricing items from PostgreSQL`);
    return pricing;
  } catch (error) {
    console.error('❌ Error loading pricing data:', error.message);
    return pricingCache.data;
  }
}

async function loadCustomerData() {
  const now = Date.now();
  if (customerCache.data.length > 0 && now - customerCache.lastUpdate < CACHE_TTL) {
    return customerCache.data;
  }

  try {
    const result = await pgPool.query(
      `SELECT
         id              AS customer_id,
         id              AS sub_id,
         nama,
         wa_pelanggan,
         email,
         produk,
         subscription,
         start_membership,
         end_membership,
         status_payment,
         slot
       FROM customer_subscriptions
       ORDER BY nama`
    );

    const customers = result.rows.map(row => ({
      customer_id:      row.customer_id,
      sub_id:           row.sub_id,
      nama:             row.nama || '',
      wa_pelanggan:     row.wa_pelanggan || '',
      email:            row.email || '',
      produk:           row.produk || '',
      subscription:     row.subscription || '',
      start_membership: row.start_membership || '',
      end_membership:   row.end_membership || '',
      status_payment:   row.status_payment || '',
      slot:             row.slot || '',
    }));

    customerCache = { data: customers, lastUpdate: now };
    console.log(`✅ Loaded ${customers.length} customer records from PostgreSQL`);
    return customers;
  } catch (error) {
    console.error('❌ Error loading customer data:', error.message);
    return customerCache.data;
  }
}

// Load Group account data
async function loadGroupData() {
  const now = Date.now();
  if (groupCache.data && Object.keys(groupCache.data).length > 0 && now - groupCache.lastUpdate < CACHE_TTL) {
    return groupCache.data;
  }

  try {
    const result = await pgPool.query(
      `SELECT subscription, code, email, password, max_slots
       FROM groups
       WHERE COALESCE(LOWER(status), 'active') != 'inactive'
       ORDER BY subscription`
    );

    const groups = {};
    result.rows.forEach(row => {
      if (row.subscription) {
        groups[row.subscription] = {
          code:      row.code      || '',
          email:     row.email     || '',
          password:  row.password  || '',
          max_slots: parseInt(row.max_slots) || 5,
        };
      }
    });

    groupCache = { data: groups, lastUpdate: now };
    console.log(`✅ Loaded ${Object.keys(groups).length} group accounts from PostgreSQL`);
    return groups;
  } catch (error) {
    console.error('❌ Error loading group data:', error.message);
    return groupCache.data || {};
  }
}

// Load override list dari file override.txt
// Format: hanya nomor saja (satu nomor per baris)
// Nama akan di-lookup dari Customer sheet saat load
async function loadOverrideList() {
  try {
    const overrideFilePath = './override.txt';
    const phoneNumbers = [];
    
    if (fs.existsSync(overrideFilePath)) {
      const content = fs.readFileSync(overrideFilePath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          const cleanedPhone = trimmed.replace(/\D/g, '');
          if (cleanedPhone.length > 0) {
            phoneNumbers.push(cleanedPhone);
          }
        }
      }
    }
    
    // Jika ada nomor di file, lookup nama dari Customer sheet
    if (phoneNumbers.length > 0) {
      const customerData = await loadCustomerData();
      
      for (const phone of phoneNumbers) {
        let customerName = 'Unknown';
        
        // Cari di Customer sheet
        for (const customer of customerData) {
          if (customer.wa_pelanggan) {
            const cleanCustomerPhone = customer.wa_pelanggan.replace(/[^0-9]/g, '');
            if (cleanCustomerPhone.includes(phone) || phone.includes(cleanCustomerPhone)) {
              customerName = customer.nama || 'Unknown';
              break;
            }
          }
        }
        
        overrideList.push({ phone, name: customerName });
      }
      
      if (overrideList.length > 0) {
        console.log(`⛔ Override list loaded: ${overrideList.length} nomor(s)`);
        overrideList.forEach(item => {
          console.log(`   - ${item.phone} (${item.name})`);
        });
      }
    }
  } catch (error) {
    console.error('⚠️  Error loading override list:', error.message);
  }
}

// Format date to dd/mm/yyyy
function formatDateToDDMMYYYY(dateInput) {
  if (!dateInput) return 'N/A';
  
  try {
    let date;
    
    // If it's already a Date object
    if (dateInput instanceof Date) {
      date = dateInput;
    } else {
      // Parse string
      const dateString = String(dateInput).trim();
      
      if (dateString.includes('-')) {
        // YYYY-MM-DD format
        const [year, month, day] = dateString.split('-');
        date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else if (dateString.includes('/')) {
        // DD/MM/YYYY or MM/DD/YYYY format
        const [part1, part2, part3] = dateString.split('/');
        if (parseInt(part1) > 12) {
          // DD/MM/YYYY
          date = new Date(parseInt(part3), parseInt(part2) - 1, parseInt(part1));
        } else {
          // Assume MM/DD/YYYY
          date = new Date(parseInt(part3), parseInt(part1) - 1, parseInt(part2));
        }
      } else {
        // Try to parse as ISO or other format
        date = new Date(dateString);
      }
    }
    
    if (isNaN(date.getTime())) {
      return dateInput; // Return original if parsing failed
    }
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  } catch (error) {
    return dateInput;
  }
}

// Parse profil & PIN from customer sheet (Format: "NAME 1234" or "NAME-1234")
function parseProfilPin(profilPinText) {
  if (!profilPinText) return { profil: 'N/A', pin: 'N/A' };
  
  const text = profilPinText.trim();
  
  // Try to find pattern: "NAME 1234" or "NAME-1234"
  const match = text.match(/^(.+?)\s+(\d{4,5})$/);
  if (match) {
    return {
      profil: match[1].trim().toUpperCase(),
      pin: match[2]
    };
  }
  
  // If no match, try to split by space or dash
  const parts = text.split(/[\s\-]/);
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    if (/^\d{4,5}$/.test(lastPart)) {
      return {
        profil: parts.slice(0, -1).join(' ').toUpperCase(),
        pin: lastPart
      };
    }
  }
  
  return { profil: text.toUpperCase(), pin: 'N/A' };
}

// Fungsi untuk cek apakah nomor adalah pelanggan
function isCustomer(phoneNumber, customers) {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  return customers.some(c => {
    if (!c.wa_pelanggan) return false;
    const cleanCustomerPhone = c.wa_pelanggan.replace(/[^0-9]/g, '');
    return cleanCustomerPhone === cleanPhone;
  });
}

// Get conversation history untuk user
function getConversationHistory(phoneNumber) {
  const history = conversationCache.get(phoneNumber) || [];
  return history;
}

// Update conversation history
function updateConversationHistory(phoneNumber, role, content) {
  let history = conversationCache.get(phoneNumber) || [];
  
  // Add new message
  history.push({
    role: role,
    content: content,
    timestamp: Date.now()
  });
  
  // Keep only last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }
  
  conversationCache.set(phoneNumber, history);
  return history;
}

// Check if user is admin
function isAdmin(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  return ADMIN_NUMBERS.some(admin => admin.replace(/[^0-9]/g, '') === cleanPhone);
}

// Disable nomor - add ke override.txt
// Nama di-lookup dari Customer sheet saat load
async function disableNumber(phoneNumber, customerData) {
  try {
    const cleanedPhone = phoneNumber.replace(/\D/g, '');
    
    // Check if already disabled
    const exists = overrideList.find(item => item.phone === cleanedPhone);
    if (exists) {
      return { success: false, message: `❌ Nomor ${phoneNumber} sudah dalam daftar disable (${exists.name})` };
    }
    
    // Find customer name
    let customerName = 'Unknown';
    for (const customer of customerData) {
      if (customer.wa_pelanggan) {
        const cleanCustomerPhone = customer.wa_pelanggan.replace(/[^0-9]/g, '');
        if (cleanCustomerPhone.includes(cleanedPhone) || cleanedPhone.includes(cleanCustomerPhone)) {
          customerName = customer.nama || 'Unknown';
          break;
        }
      }
    }
    
    // Add to memory
    overrideList.push({ phone: cleanedPhone, name: customerName });
    
    // Write to file (format: hanya nomor, satu per baris)
    const overrideFilePath = './override.txt';
    const content = overrideList.map(item => item.phone).join('\n');
    fs.writeFileSync(overrideFilePath, content, 'utf-8');
    
    console.log(`⛔ Number ${cleanedPhone} (${customerName}) added to override list`);
    return { success: true, message: `✅ Nomor ${phoneNumber} (${customerName}) berhasil di-disable` };
  } catch (error) {
    console.error('❌ Error disabling number:', error.message);
    return { success: false, message: `❌ Error: ${error.message}` };
  }
}

// Enable nomor - remove dari override.txt
function enableNumber(phoneNumber) {
  try {
    const cleanedPhone = phoneNumber.replace(/\D/g, '');
    
    // Check if exists
    const item = overrideList.find(x => x.phone === cleanedPhone);
    if (!item) {
      return { success: false, message: `❌ Nomor ${phoneNumber} tidak dalam daftar disable` };
    }
    
    const customerName = item.name;
    
    // Remove from memory
    overrideList = overrideList.filter(n => n.phone !== cleanedPhone);
    
    // Write to file (format: hanya nomor, satu per baris)
    const overrideFilePath = './override.txt';
    const content = overrideList.length > 0 ? overrideList.map(item => item.phone).join('\n') : '';
    fs.writeFileSync(overrideFilePath, content, 'utf-8');
    
    console.log(`✅ Number ${cleanedPhone} (${customerName}) removed from override list`);
    return { success: true, message: `✅ Nomor ${phoneNumber} (${customerName}) berhasil di-enable` };
  } catch (error) {
    console.error('❌ Error enabling number:', error.message);
    return { success: false, message: `❌ Error: ${error.message}` };
  }
}

// Get override list dengan nama
function getDisabledList() {
  if (overrideList.length === 0) {
    return '✅ Tidak ada nomor yang di-disable';
  }
  
  let response = '⛔ *Daftar Nomor Disable:*\n\n';
  overrideList.forEach((item, idx) => {
    const displayPhone = '+62' + item.phone.substring(2);
    response += `${idx + 1}. ${displayPhone} (${item.name})\n`;
  });
  return response;
}

// Parse override command: /disable 628xxx, /enable 628xxx, /list-override
function parseOverrideCommand(text) {
  const disableMatch = text.match(/^\/disable\s+(\d+|[0-9\-\s+]+)$/i);
  if (disableMatch) {
    return { action: 'disable', phone: disableMatch[1] };
  }
  
  const enableMatch = text.match(/^\/enable\s+(\d+|[0-9\-\s+]+)$/i);
  if (enableMatch) {
    return { action: 'enable', phone: enableMatch[1] };
  }
  
  const listMatch = text.match(/^\/list-override$/i);
  if (listMatch) {
    return { action: 'list' };
  }
  
  return null;
}

// Parse payment command: /pay 0818xxx netflix-nontv-3m
function parsePaymentCommand(text) {
  const patterns = [
    /^\/pay\s+(\d+)\s+([\w-]+)$/i,
    /^\/confirm\s+(\d+)\s+(\d+)\s+([\w-]+)$/i,
    /^\/extend\s+(\d+)\s+([\w-]+)$/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        phone: match[1],
        product: match[match.length - 1],
        amount: match.length > 3 ? match[2] : null
      };
    }
  }
  
  return null;
}

// Product code mapping
const PRODUCT_CODES = {
  // Netflix
  'netflix-nontv-1m': { product: 'Netflix Premium - Non TV Access', duration: '1 Bulan', months: 1 },
  'netflix-nontv-3m': { product: 'Netflix Premium - Non TV Access', duration: '3 Bulan', months: 3 },
  'netflix-nontv-6m': { product: 'Netflix Premium - Non TV Access', duration: '6 Bulan', months: 6 },
  'netflix-nontv-12m': { product: 'Netflix Premium - Non TV Access', duration: '12 Bulan', months: 12 },
  'netflix-tv-1m': { product: 'Netflix Premium - TV Shared Access', duration: '1 Bulan', months: 1 },
  'netflix-tv-3m': { product: 'Netflix Premium - TV Shared Access', duration: '3 Bulan', months: 3 },
  'netflix-tv-6m': { product: 'Netflix Premium - TV Shared Access', duration: '6 Bulan', months: 6 },
  'netflix-tv-12m': { product: 'Netflix Premium - TV Shared Access', duration: '12 Bulan', months: 12 },
  
  // YouTube Premium
  'youtube-premium-1m': { product: 'YouTube Premium', duration: '1 Bulan', months: 1 },
  'youtube-premium-3m': { product: 'YouTube Premium', duration: '3 Bulan', months: 3 },
  'youtube-premium-6m': { product: 'YouTube Premium', duration: '6 Bulan', months: 6 },
  'youtube-premium-12m': { product: 'YouTube Premium', duration: '12 Bulan', months: 12 },
  
  // Spotify
  'spotify-1m': { product: 'Spotify Premium', duration: '1 Bulan', months: 1 },
  'spotify-3m': { product: 'Spotify Premium', duration: '3 Bulan', months: 3 },
  'spotify-6m': { product: 'Spotify Premium', duration: '6 Bulan', months: 6 },
  'spotify-12m': { product: 'Spotify Premium', duration: '12 Bulan', months: 12 },
  
  // Canva Pro
  'canva-1m': { product: 'Canva Pro', duration: '1 Bulan', months: 1 },
  'canva-3m': { product: 'Canva Pro', duration: '3 Bulan', months: 3 },
  'canva-6m': { product: 'Canva Pro', duration: '6 Bulan', months: 6 },
  'canva-12m': { product: 'Canva Pro', duration: '12 Bulan', months: 12 },
  
  // Disney+
  'disney-1m': { product: 'Disney+', duration: '1 Bulan', months: 1 },
  'disney-3m': { product: 'Disney+', duration: '3 Bulan', months: 3 },
  'disney-6m': { product: 'Disney+', duration: '6 Bulan', months: 6 },
  'disney-12m': { product: 'Disney+', duration: '12 Bulan', months: 12 },
  
  // Microsoft 365
  'microsoft-1m': { product: 'Microsoft 365', duration: '1 Bulan', months: 1 },
  'microsoft-3m': { product: 'Microsoft 365', duration: '3 Bulan', months: 3 },
  'microsoft-6m': { product: 'Microsoft 365', duration: '6 Bulan', months: 6 },
  'microsoft-12m': { product: 'Microsoft 365', duration: '12 Bulan', months: 12 },
  
  // Apple Music
  'apple-1m': { product: 'Apple Music', duration: '1 Bulan', months: 1 },
  'apple-3m': { product: 'Apple Music', duration: '3 Bulan', months: 3 },
  'apple-6m': { product: 'Apple Music', duration: '6 Bulan', months: 6 },
  'apple-12m': { product: 'Apple Music', duration: '12 Bulan', months: 12 },
  
  // HBO GO Max
  'hbo-1m': { product: 'HBO GO Max', duration: '1 Bulan', months: 1 },
  'hbo-3m': { product: 'HBO GO Max', duration: '3 Bulan', months: 3 },
  'hbo-6m': { product: 'HBO GO Max', duration: '6 Bulan', months: 6 },
  'hbo-12m': { product: 'HBO GO Max', duration: '12 Bulan', months: 12 },
  
  // Prime Video
  'prime-1m': { product: 'Prime Video', duration: '1 Bulan', months: 1 },
  'prime-3m': { product: 'Prime Video', duration: '3 Bulan', months: 3 },
  'prime-6m': { product: 'Prime Video', duration: '6 Bulan', months: 6 },
  'prime-12m': { product: 'Prime Video', duration: '12 Bulan', months: 12 },
  
  // CapCut Pro
  'capcut-1m': { product: 'CapCut Pro', duration: '1 Bulan', months: 1 },
  'capcut-3m': { product: 'CapCut Pro', duration: '3 Bulan', months: 3 },
  'capcut-6m': { product: 'CapCut Pro', duration: '6 Bulan', months: 6 },
  'capcut-12m': { product: 'CapCut Pro', duration: '12 Bulan', months: 12 },
};

// Process payment confirmation
async function processPaymentConfirmation(command, customers) {
  try {
    const productInfo = PRODUCT_CODES[command.product.toLowerCase()];
    if (!productInfo) {
      return `❌ Product code tidak valid: ${command.product}\n\nValid codes: netflix-nontv-3m, netflix-tv-6m, dll.`;
    }
    
    // Load Group data for username/password
    const groupData = await loadGroupData();
    
    // Find customer by phone - can return multiple subscriptions
    const cleanPhone = command.phone.replace(/^0/, '628');
    const matchingCustomers = customers.filter(c => {
      if (!c.wa_pelanggan) return false;
      const cleanCustomerPhone = c.wa_pelanggan.replace(/[^0-9]/g, '');
      return cleanCustomerPhone.includes(cleanPhone) || cleanPhone.includes(cleanCustomerPhone);
    });
    
    if (matchingCustomers.length === 0) {
      return `❌ Customer tidak ditemukan dengan nomor: ${command.phone}`;
    }
    
    // Filter by product type (Netflix for netflix codes, VPN for vpn codes, etc)
    const productType = productInfo.product.split(' ')[0].toUpperCase(); // "NETFLIX" or "VPN"
    const productMatches = matchingCustomers.filter(c => 
      c.produk && c.produk.toUpperCase().includes(productType)
    );
    
    if (productMatches.length === 0) {
      return `❌ Customer ${command.phone} tidak punya langganan ${productType}.\n\nLangganan yang ada: ${matchingCustomers.map(c => c.produk).filter(p => p).join(', ')}`;
    }
    
    // If multiple subscriptions for same product, prioritize:
    // 1. Unpaid status first
    // 2. Earliest expiry date
    let customer;
    if (productMatches.length > 1) {
      const unpaid = productMatches.find(c => !c.status_payment || c.status_payment.toUpperCase() !== 'PAID');
      if (unpaid) {
        customer = unpaid;
      } else {
        // All paid, take earliest expiry
        customer = productMatches.sort((a, b) => {
          const dateA = a.end_membership ? new Date(a.end_membership) : new Date();
          const dateB = b.end_membership ? new Date(b.end_membership) : new Date();
          return dateA - dateB;
        })[0];
      }
      console.log(`   ⚠️  Multiple ${productType} subscriptions found. Selected: ${customer.subscription} (Status: ${customer.status_payment || 'UNPAID'}, Exp: ${customer.end_membership})`);
    } else {
      customer = productMatches[0];
    }
    
    if (!customer) {
      return `❌ Customer tidak ditemukan dengan nomor: ${command.phone}`;
    }
    
    // Detect if this is NEW subscription or RENEWAL
    // NEW: Member since (F) = Start membership (G) → First time customer
    // RENEWAL: Member since (F) ≠ Start membership (G) → Returning customer
    const memberSince = customer.member_since?.trim() || '';
    const startMembership = customer.start_membership?.trim() || '';
    
    const isNewSubscription = memberSince === startMembership || !memberSince || !startMembership;
    
    console.log(`   ${isNewSubscription ? '🆕' : '🔄'} ${isNewSubscription ? 'NEW subscription' : 'RENEWAL'} detected (Member since: ${memberSince || 'N/A'}, Start: ${startMembership || 'N/A'})`);
    
    // Calculate new exp date
    const currentExp = customer.end_membership ? new Date(customer.end_membership) : new Date();
    const newExpDate = new Date(currentExp);
    newExpDate.setMonth(newExpDate.getMonth() + productInfo.months);
    
    // Format date in dd/mm/yyyy
    const sheetDateFormat = formatDateToDDMMYYYY(newExpDate);
    
    // Format date for display
    const displayDate = newExpDate.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
    
    // Update PostgreSQL: end_date, status, invalidate cache
    console.log(`   📝 Updating subscription ID ${customer.sub_id}: ${customer.produk} - ${customer.nama}`);

    await pgPool.query(
      `UPDATE customer_subscriptions
          SET end_membership = $1,
              status_payment = 'PAID',
              updated_at = NOW()
        WHERE id = $2`,
      [newExpDate, customer.sub_id]
    );

    // Invalidate customer cache so next request gets fresh data
    customerCache = { data: [], lastUpdate: 0 };
    
    // Get Group account info for this subscription
    const groupInfo = groupData[customer.subscription] || {};
    const groupEmail = groupInfo.email || 'N/A';
    const groupPassword = groupInfo.password || 'N/A';
    
    // Parse profil & PIN from customer data
    const { profil, pin } = parseProfilPin(customer.profil_pin);
    
    // Detect product type and account category
    const produkUpper = (customer.produk || productInfo.product).toUpperCase();
    
    let accountType = '';
    let emoji = '📱';
    
    // Set emoji and account type based on product
    if (produkUpper.includes('NETFLIX')) {
      // Check if NON TV or SHARED TV
      if (customer.subscription && customer.subscription.toUpperCase().includes('SHARED')) {
        emoji = '✅📺';
        accountType = 'SHARED TV';
      } else if (customer.subscription && customer.subscription.toUpperCase().includes('EXCLUSIVE')) {
        emoji = '✅📺';
        accountType = 'TV EXCLUSIVE';
      } else {
        emoji = '❌📺';
        accountType = 'NON TV';
      }
    }
    else if (produkUpper.includes('YOUTUBE')) {
      emoji = '🎬';
    }
    else if (produkUpper.includes('SPOTIFY')) {
      emoji = '🎧';
    }
    else if (produkUpper.includes('CANVA')) {
      emoji = '🎨';
    }
    else if (produkUpper.includes('DISNEY')) {
      emoji = '🏰';
    }
    else if (produkUpper.includes('HBO')) {
      emoji = '🎭';
    }
    else if (produkUpper.includes('PRIME')) {
      emoji = '📺';
    }
    else if (produkUpper.includes('MICROSOFT')) {
      emoji = '💼';
    }
    else if (produkUpper.includes('APPLE')) {
      emoji = '🎵';
    }
    else if (produkUpper.includes('CAPCUT')) {
      emoji = '✂️';
    }
    
    // Format duration
    let extendedDuration = productInfo.duration;
    if (extendedDuration === '1 Bulan') {
      extendedDuration = 'A Month';
    } else if (extendedDuration === '3 Bulan') {
      extendedDuration = '3 Months';
    } else if (extendedDuration === '6 Bulan') {
      extendedDuration = '6 Months';
    } else if (extendedDuration === '12 Bulan') {
      extendedDuration = 'A Year';
    }
    
    const subscriptionName = customer.subscription || productInfo.product;
    const actionWord = isNewSubscription ? 'Subscription' : 'Extended';
    
    // Get customer email from sheet (Column P/15)
    const customerEmail = customer.email || 'N/A';
    
    // Build notification message based on product type
    let notificationMessage;
    
    // SPOTIFY - Special format with profile name from Group sheet
    if (produkUpper.includes('SPOTIFY')) {
      const profileName = groupPassword; // For Spotify, Column E contains profile name only
      notificationMessage = `*${emoji}${subscriptionName}*

User : *${profileName}*

${actionWord} *${extendedDuration}*
Exp Date : *${displayDate}*`;
    }
    // DISNEY+ - Login Number format
    else if (produkUpper.includes('DISNEY')) {
      const loginNumber = groupEmail; // Column D contains phone number
      notificationMessage = `*${emoji}${subscriptionName}*

Login Number : *${loginNumber}*
_OTP by Request_

Profil : *${profil}*

${actionWord} *${extendedDuration}*
Exp Date : *${displayDate}*`;
    }
    // NETFLIX - Traditional sharing with username/password/profil/PIN
    else if (produkUpper.includes('NETFLIX')) {
      notificationMessage = `*${emoji}${subscriptionName}*
${emoji} *(${accountType})*

Username : ${groupEmail}
Password : ${groupPassword}

Profil : *${profil}*
PIN : ${pin}

${actionWord} *${extendedDuration}*
Exp Date : *${displayDate}*`;
    }
    // HBO, PRIME - Traditional sharing format
    else if (produkUpper.includes('HBO') || produkUpper.includes('PRIME')) {
      notificationMessage = `*${subscriptionName}*
${emoji} *(Sharing)*

Username : ${groupEmail}
Password : ${groupPassword}

Profil : *${profil}*
PIN : ${pin}

${actionWord} *${extendedDuration}*
Exp Date : *${displayDate}*`;
    }
    // FAMILY ACCOUNTS - YouTube, Canva, Microsoft, Apple Music, CapCut
    else {
      notificationMessage = `*${emoji}${subscriptionName}*

user : ${customerEmail}

${actionWord} *${extendedDuration}*
Exp Date : *${displayDate}*`;
    }
    
    const actionLabel = isNewSubscription ? 'activate' : 'extend';
    
    return {
      success: true,
      customerJid: customer.wa_pelanggan.replace(/[^0-9]/g, '') + '@s.whatsapp.net',
      message: notificationMessage,
      adminMessage: `✅ Berhasil ${actionLabel} *${customer.nama}* (${customer.wa_pelanggan})

Subscription: ${subscriptionName}
Produk: ${productInfo.product} - ${productInfo.duration}
${isNewSubscription ? 'Start Date' : 'Old Exp'}: ${customer.end_membership || 'N/A'}
New Exp: ${sheetDateFormat}
Row: ${customer.rowIndex}`
    };
    
  } catch (error) {
    console.error('❌ Error processing payment:', error);
    return `❌ Error: ${error.message}`;
  }
}

// Fungsi untuk extract intent dari pertanyaan user
// Helper: Find product(s) di availability map berdasarkan user message
// Returns array of matching products sorted by: available first, then by slot count
// Ambil nama produk yang bersih dari nama group internal
// e.g. "#Spotify Premium 10" → "Spotify Premium"
// e.g. "Disney+ Hotstar Group 4" → "Disney+ Hotstar"
// e.g. "HBO MAX 01 JUSTICE LEAGUE" → "HBO MAX"
// e.g. "MICROSOFT 365 - PERSONAL" → "Microsoft 365"
function extractProductDisplayName(groupName) {
  return groupName
    .replace(/^#/, '')                           // hapus leading #
    .replace(/\s+Group\s+\d+.*$/i, '')           // hapus "Group N" dan setelahnya
    .replace(/\s+\d{2}\s+[A-Z][A-Z\s]+$/, '')   // hapus "01 JUSTICE LEAGUE" pattern
    .replace(/\s*-\s*.*$/, '')                   // hapus " - SUBTITLE" atau "-SUBTITLE"
    .replace(/\s+\d+$/, '')                      // hapus trailing number
    .trim()
    // Title case: "MICROSOFT 365" → "Microsoft 365"
    .replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    // Fix common abbreviations: "Hbo" → "HBO", "Tv" → "TV"
    .replace(/\b(Hbo|Tv|Vpn|Otp|Uhd|4k)\b/gi, w => w.toUpperCase());
}

function detectProductFromMessage(message, availabilityMap) {
  const msg = message.toLowerCase().replace(/[+.]/g, '');
  const matches = [];

  // Keyword aliases for common shorthand
  const aliases = {
    'disney':   ['disney', 'disney+', 'hotstar'],
    'netflix':  ['netflix', 'nf'],
    'youtube':  ['youtube', 'yt', 'ytb'],
    'spotify':  ['spotify'],
    'hbo':      ['hbo', 'hbomax', 'hbo max'],
    'prime':    ['prime', 'amazon'],
    'canva':    ['canva'],
    'microsoft':['microsoft', 'ms365', 'office'],
    'capcut':   ['capcut'],
    'vpn':      ['vpn'],
    'apple':    ['apple music'],
  };

  for (const productName of Object.keys(availabilityMap)) {
    const nameLower = productName.toLowerCase().replace(/[+.]/g, '');
    const nameWords = nameLower.split(' ');

    // Check direct word match OR alias match
    const directMatch = nameWords.some(w => w.length > 3 && msg.includes(w));
    const aliasMatch  = Object.entries(aliases).some(([key, aliasList]) =>
      nameLower.includes(key) && aliasList.some(a => msg.includes(a.replace(/[+.]/g, '')))
    );

    if (directMatch || aliasMatch) {
      const hasVariant = /\d/.test(productName);
      if (hasVariant || availabilityMap[productName].totalSlots > 0) {
        matches.push({
          name:      productName,
          available: availabilityMap[productName].available,
          slots:     availabilityMap[productName].totalSlots,
        });
      }
    }
  }

  // Sort: available products first, then by slot count (highest first)
  matches.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (b.slots || 0) - (a.slots || 0);
  });

  // Return either single match atau array jika multiple variants
  if (matches.length === 1) {
    return matches[0].name;
  } else if (matches.length > 1) {
    return matches.map(m => m.name); // Return array of product names (sorted with available first)
  }
  
  return null;
}

async function extractIntent(userMessage, pricingData, conversationHistory = [], contextData = {}) {
  const productList = [...new Set(pricingData.map(p => p.product))].join(', ');
  const { confidence = 50, alreadyAskedClarification = false, badMomentum = false } = contextData;

  // Build history context string (last 4 messages) supaya pesan pendek bisa dipahami dalam konteks
  let historyContext = '';
  if (conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-4);
    historyContext = `\n\nHistory percakapan sebelumnya (gunakan sebagai konteks):\n` +
      recent.map(m => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content.substring(0, 150)}`).join('\n');
  }
  
  // SMART CLARIFICATION LOGIC:
  // - Jika confidence >= 80% → assume dan langsung jawab (jangan tanya)
  // - Jika confidence 60-79% → acknowledge assumption tapi tetap jawab (jangan tanya)
  // - Jika confidence < 60% DAN belum pernah tanya → ask clarification
  // - Jika confidence < 60% TAPI sudah pernah tanya → just answer with assumption
  let clarificationGuidance = '';
  
  if (confidence >= 80) {
    clarificationGuidance = `\n\nNOTA: Confidence score TINGGI (${confidence}%). LANGSUNG JAWAB tanpa perlu tanya ulang!`;
  } else if (confidence >= 60 && confidence < 80) {
    clarificationGuidance = `\n\nNOTA: Confidence score MEDIUM (${confidence}%). Acknowledge assumption tapi LANGSUNG JAWAB, jangan tanya ulang!`;
  } else if (alreadyAskedClarification) {
    clarificationGuidance = `\n\nNOTA: Bot sudah tanya clarification sebelumnya. LANGSUNG JAWAB dengan asumsi dari history, jangan tanya lagi!`;
  } else if (badMomentum) {
    clarificationGuidance = `\n\nNOTA: Momentum conversasi terganggu (3+ short messages). Keep response minimal, jangan tanya clarification!`;
  }

  const prompt = `Analisa pertanyaan customer service ini dan kategorisasi:

Produk tersedia: ${productList}${historyContext}${clarificationGuidance}

Pesan terbaru customer: "${userMessage}"

PERHATIAN: Gunakan history di atas sebagai konteks. Contoh: jika history bicara soal YouTube Premium dan pesan baru adalah "bayarnya gimana?" atau "transfer kemana?", itu adalah intent "renewal" dengan product "YouTube Premium".

JANGAN PERNAH TANYA PRODUK ULANG jika sudah disebutkan di history atau confidence score tinggi. Lebih baik jawab dengan assumption.

Kategori intent:
1. **troubleshooting** - Masalah OTP, password, login, akun error → {"intent": "support"}
2. **renewal** - Mau perpanjang langganan, tanya cara bayar, transfer, konfirmasi bayar → {"intent": "renewal", "product": "nama produk dari history jika tidak disebutkan"}
3. **price_inquiry** - Tanya harga spesifik → extract product & duration
4. **availability_inquiry** - Tanya apakah produk tersedia/ada slot/ready/kosong/full ("ada?", "ready?", "ada slot?", "masih ada?", "kosong gak?") → {"intent": "availability_inquiry", "product": "nama produk"}
5. **product_info** - Tanya "basic/premium/family", "ada apa aja", kategori produk → {"intent": "product_catalog"}
6. **subscription_inquiry** - Tanya "saya langganan apa saja?", "daftar langganan saya", "langganan saya apa?", "saya punya produk apa?" → {"intent": "subscription_inquiry"}
7. **greeting** - Halo, hi, salam → {"intent": "greeting"}

Response format JSON:
{
  "intent": "support" | "renewal" | "price_inquiry" | "availability_inquiry" | "product_catalog" | "subscription_inquiry" | "greeting" | "unclear",
  "product": "nama produk atau null",
  "duration": "durasi atau null",
  "issue_type": "otp" | "password" | "login" | null
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('❌ Error extracting intent:', error.message);
    return { intent: 'unclear', product: null, duration: null, issue_type: null };
  }
}

// Fungsi untuk query pricing
function queryPricing(pricingData, product, duration) {
  if (!product || !duration) return null;
  
  const result = pricingData.find(p => 
    p.product.toLowerCase() === product.toLowerCase() &&
    p.duration.toLowerCase() === duration.toLowerCase()
  );
  
  return result;
}

// Check product availability berdasarkan Customer sheet Slot data
async function checkProductAvailability(groupData, pricingData, customerData) {
  try {
    // Hitung jumlah customer aktif per subscription group
    const customerCountPerGroup = {};
    for (const customer of customerData) {
      const subName = customer.subscription;
      if (subName && subName.trim()) {
        customerCountPerGroup[subName] = (customerCountPerGroup[subName] || 0) + 1;
      }
    }

    // Build availability map: available jika max_slots - filled > 0
    const availability = {};
    for (const groupName of Object.keys(groupData)) {
      const group = groupData[groupName];
      const maxSlots  = group.max_slots || 5;
      const filled    = customerCountPerGroup[groupName] || 0;
      const freeSlots = maxSlots - filled;
      const isAvailable = freeSlots > 0;

      availability[groupName] = {
        available:  isAvailable,
        reason:     isAvailable ? `${freeSlots} slot tersedia (${filled}/${maxSlots})` : `FULL (${filled}/${maxSlots})`,
        totalSlots: freeSlots,
        groupInfo: {
          email:    group.email    || 'N/A',
          password: group.password ? '***' : 'N/A',
        },
      };
    }

    return availability;
  } catch(error) {
    console.error('Error checking availability:', error.message);
    return {};
  }
}

// Format availability info for user response
function formatAvailabilityInfo(availability) {
  const available = [];
  const unavailable = [];
  
  for (const [name, info] of Object.entries(availability)) {
    if (info.available) {
      available.push(name);
    } else {
      unavailable.push({ name, reason: info.reason });
    }
  }
  
  let response = '';
  
  if (available.length > 0) {
    response += '✅ **Produk Tersedia:**\n';
    available.forEach(p => response += `• ${p}\n`);
  }
  
  if (unavailable.length > 0) {
    response += '\n❌ **Produk Tidak Tersedia:**\n';
    unavailable.forEach(p => response += `• ${p.name} (${p.reason})\n`);
  }
  
  return response || 'Tidak ada data ketersediaan produk';
}

// Fungsi untuk search knowledge dari Qdrant Vector DB (RAG)
async function searchKnowledge(userQuery, topK = 3) {
  if (!qdrant) {
    console.log('⚠️ Qdrant not available, skipping vector search');
    return [];
  }

  try {
    console.log(`🔍 Searching vector DB for: "${userQuery}"`);
    
    // Generate embedding untuk query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: userQuery,
    });
    
    const queryVector = embeddingResponse.data[0].embedding;
    
    // Search di Qdrant
    const searchResult = await qdrant.search(COLLECTION_NAME, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
    });
    
    if (searchResult.length === 0) {
      console.log('   ⚠️  No relevant knowledge found');
      return [];
    }
    
    console.log(`   ✅ Found ${searchResult.length} relevant knowledge entries`);
    searchResult.forEach((result, idx) => {
      console.log(`      ${idx + 1}. [${result.payload.category}] ${result.payload.topic} (score: ${result.score.toFixed(3)})`);
    });
    
    return searchResult.map(r => r.payload);
  } catch (error) {
    console.error('❌ Error searching knowledge:', error.message);
    return [];
  }
}

// Fungsi untuk web search menggunakan SerpAPI (untuk query di luar knowledge base)
async function webSearch(userQuery, topK = 3) {
  if (!SERPAPI_KEY) {
    console.log('⚠️ SerpAPI key not available, skipping web search');
    return [];
  }

  try {
    console.log(`🌐 Searching internet for: "${userQuery}"`);
    
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        q: userQuery,
        api_key: SERPAPI_KEY,
        num: topK,
        engine: 'google',
      },
    });
    
    const results = response.data.organic_results || [];
    
    if (results.length === 0) {
      console.log('   ⚠️  No web search results found');
      return [];
    }
    
    console.log(`   ✅ Found ${results.length} web search results`);
    
    // Format results untuk context
    return results.slice(0, topK).map(result => ({
      category: 'WEB_SEARCH',
      topic: result.title,
      content: `${result.snippet}\n\nSource: ${result.link}`,
      url: result.link,
    }));
  } catch (error) {
    console.error('❌ Error with web search:', error.message);
    return [];
  }
}

// Fungsi untuk generate response menggunakan LLM dengan RAG
async function generateResponse(userMessage, pricingResult, customerName = null, knowledgeContexts = [], conversationHistory = []) {
  let systemPrompt = `Kamu adalah CS support untuk layanan subscription produk digital (Netflix, YouTube Premium, Disney+, Spotify, dll).
Prioritas: SUPPORT CUSTOMER, bukan jualan. Customer biasanya menanyakan:
1. Kendala teknis (OTP login, password, akun bermasalah)
2. Perpanjangan langganan yang akan expired
3. Jarang yang tanya harga duluan

⚠️ IMPORTANT - KAPAN HARUS DEFER KE ADMIN:
- Jika customer EKSPLISIT minta proses order/pembayaran untuk langganan BARU (contoh: "mau order", "mau daftar", "transfer ke mana?") → Bilang "Tim admin akan proses"
- ⚠️ JANGAN defer jika customer HANYA tanya harga, fitur produk, atau cek ketersediaan — jawab langsung
- ⚠️ JANGAN defer jika customer tanya spesifikasi produk ("dapat OneDrive?", "bisa berapa device?") — jawab dari knowledge base
- Jika pertanyaan TIDAK JELAS → Tanya spesifik: "Bisa dijelaskan lebih detail?"
- Jika customer sudah bayar/transfer → Bilang "Terima kasih, admin akan cek konfirmasi pembayaran"
- Jika customer tanya hal yang TIDAK ada di knowledge base → Bilang "Saya hubungkan dengan admin ya"

PRODUK YANG TERSEDIA (kategorisasi):
**Streaming Video:**
- Netflix (3 jenis: TV Shared, TV Exclusive - SOLD OUT, Non TV Access)
- Disney+ Hotstar
- Prime Video
- HBO GO Max

**Music Streaming:**
- YouTube Premium
- Spotify Premium
- Apple Music

**Productivity:**
- Canva Pro
- Microsoft 365 (Personal, Family)
- CapCut Pro

**VPN:**
- VPN Unlimited

FAQ TROUBLESHOOTING:
**Netflix First Login OTP Issue:**
Jawab: "Untuk Netflix first login, jika diminta 4 kode OTP, klik 'Get Help' → lalu klik 'use password instead'. Password sudah saya share sebelumnya."

**Prime Video / Disney+ OTP Issue:**
Jawab: "Untuk first login Prime/Disney+, saya akan bantu kirimkan OTP-nya. Tunggu sebentar ya."

**Perpanjangan Langganan:**
Jawab dengan cek produk dan akun mereka, tanyakan: "Untuk perpanjangan [produk] dengan akun [email], mau diperpanjang berapa lama?"

ATURAN RESPONSE:
1. Deteksi bahasa user (ID/EN) dan jawab dengan bahasa yang sama
2. Kalau tanya "Basic/Premium/Family" → jelaskan kategori produk di atas (bukan paket DigiLife)
3. ⚠️ FORMAT HARGA:
   - Tampilkan sebagai BULLET LIST dengan \`-\` (tidak boleh numbered)
   - Contoh: \`- 1 bulan: *Rp 55.000*\` (bold harga)
   - Jika ada promo: \`- 1 bulan: ~Rp 76.000~ *Rp 70.000*\` (strikethrough normal, bold promo)
   - ⛔ JANGAN gunakan asterisk di strikethrough: salah \`~Rp 76.000*\`, benar: \`~Rp 76.000~\`
4. ⛔ DILARANG KERAS mengarang atau menghitung harga — hanya tampilkan harga yang ADA PERSIS di KNOWLEDGE BASE
5. ⛔ DILARANG menampilkan durasi yang TIDAK ADA di KNOWLEDGE BASE (contoh: jangan tulis "12 bulan" jika tidak ada di list)
6. ⛔ JANGAN sebutkan variant lain yang kosong/SOLD OUT kecuali customer EKSPLISIT tanya (contoh: "variant lain apa saja?")
   - Jika customer tanya "harga Netflix TV", cukup tampilkan TV Shared & TV Exclusive variants + harganya
   - JANGAN ikut mention "TV Exclusive SOLD OUT" atau "Non-TV" kecuali mereka minta
7. Jika durasi yang ditanya tidak ada di data → jawab "Untuk durasi tersebut belum tersedia ka, tersedia [sebutkan hanya yang ada]"
8. Response singkat & to-the-point — JANGAN tambahin closing verbose seperti "Jika ada yang ingin kamu tanyakan lebih lanjut, silakan beri tahu!" atau "Jangan ragu untuk menghubungi!"
9. Kalau tidak jelas, tanya spesifik: "Untuk produk apa kak? Netflix, YouTube, atau yang lain?"`;

  if (customerName) {
    systemPrompt += `\n\nNama customer: *${customerName}* (pelanggan terdaftar). Sapa dengan "ka *${customerName}*" di awal balasan pertama dalam percakapan.`;
  }

  // Instruksi penggunaan history — penting untuk pesan pendek/ambigu
  systemPrompt += `\n\n⚠️ GUNAKAN CONVERSATION HISTORY: Sebelum meminta klarifikasi, cek dulu history di atas. Jika context sudah jelas dari percakapan sebelumnya (contoh: user baru tanya harga YouTube lalu bertanya "bayarnya gimana?"), JAWAB LANGSUNG menggunakan konteks itu. Jangan tanya ulang produk yang sudah disebutkan dalam history.`;

  // Tambahkan knowledge context dari Vector DB jika ada
  if (knowledgeContexts.length > 0) {
    systemPrompt += `\n\n**KNOWLEDGE BASE (gunakan ini untuk menjawab):**\n`;
    knowledgeContexts.forEach((ctx, idx) => {
      systemPrompt += `\n${idx + 1}. [${ctx.category}] ${ctx.topic}:\n${ctx.content}\n`;
    });
  }

  let userPrompt = `Customer: "${userMessage}"`;

  if (pricingResult) {
    const priceFormatted = pricingResult.price.toLocaleString('id-ID');
    const priceNonPromoFormatted = pricingResult.price_non_promo > 0 
      ? pricingResult.price_non_promo.toLocaleString('id-ID') 
      : null;

    userPrompt += `\n\nData harga:
Produk: ${pricingResult.product}
Durasi: ${pricingResult.duration}
${priceNonPromoFormatted ? `Harga Reguler: ${priceNonPromoFormatted}\n` : ''}Harga Promo: ${priceFormatted}

Response: Jawab natural, format harga ~Rp X~ *Rp Y* jika ada promo (gunakan WhatsApp strikethrough).`;
  } else {
    const hasPricingContext = knowledgeContexts.some(ctx => ctx.category === 'PRICING');
    if (hasPricingContext) {
      userPrompt += `\n\nGunakan data harga dari KNOWLEDGE BASE di atas untuk menjawab. Format: bullet list dengan tanda "-". Contoh:
- 1 bulan: *Rp 55.000*
- 3 bulan: ~Rp 76.000~ *Rp 70.000* (jika ada promo)

Response singkat, jangan verbose. Harus natural, tidak robotic!`;
    } else {
      userPrompt += `\n\nTidak ada data harga spesifik. 
Analisa dulu: Apakah pertanyaan tentang:
1. Troubleshooting/kendala teknis → Jawab sesuai FAQ
2. Tanya kategori produk ("basic/premium/family"?) → Jelaskan kategori streaming/music/productivity
3. Tanya harga tapi tidak spesifik → Tanyakan produk spesifik (jangan list semua, kasih contoh 3-4 saja)
4. Perpanjangan → Tanyakan produk dan akun

Response harus natural, jangan robotic!`;
    }
  }

  try {
    // Build messages array dengan conversation history
    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add conversation history (hanya last 5 messages untuk hemat token)
    const recentHistory = conversationHistory.slice(-5);
    recentHistory.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });
    
    // Add current user message
    messages.push({ role: 'user', content: userPrompt });
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 300,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ Error generating response:', error.message);
    return 'Maaf, saat ini sistem sedang mengalami gangguan. Silakan coba lagi.';
  }
}

// Endpoint untuk menerima pesan masuk dari bot-1
app.post('/inbound', async (req, res) => {
  try {
    const { senderJid, senderName, chatJid, text, imageUrl, media, isGroup, image, url, image_url } = req.body;

    let messageText = text || '';
    // Try multiple field names yang mungkin digunakan Fonnte
    const mediaSource = imageUrl || media || image || url || image_url || null;
    let messageType = 'text'; // Default: text message

    // DEBUG: ALWAYS log jika text adalah "non-text message" = gambar dikirim
    if (messageText === 'non-text message' || messageText === 'image' || mediaSource) {
      console.log(`📩 DEBUG: Full req.body keys:`, Object.keys(req.body));
      console.log(`📩 DEBUG: text="${text}"`);
      console.log(`📩 DEBUG: imageUrl="${imageUrl}", media="${media}", image="${image}", url="${url}", image_url="${image_url}"`);
      console.log(`📩 DEBUG: All fields:`, JSON.stringify(req.body, null, 2).substring(0, 500));
    }

    // PRIORITY 1: Jika ada gambar, FIRST cek apakah ini bukti transfer dengan Gemini
    if (mediaSource) {
      messageType = imageUrl ? 'image' : image ? 'image' : 'document';
      console.log(`📩 Incoming ${messageType.toUpperCase()} from ${senderName} (${senderJid}) - URL: ${mediaSource.substring(0, 80)}...`);
      
      // FIRST: Check payment proof dengan Gemini sebelum text extraction
      if (messageType === 'image') {
        try {
          const proofAnalysis = await analyzePaymentProof(mediaSource);
          
          // Check jika result adalah string (old format) atau object (new JSON format)
          const isPaymentProof = typeof proofAnalysis === 'string' 
            ? proofAnalysis.includes('BERHASIL') || proofAnalysis.includes('berhasil') || proofAnalysis.includes('transfer')
            : proofAnalysis.is_payment_proof === true || proofAnalysis.is_payment_proof === 'true';
          
          if (isPaymentProof) {
            console.log(`✅ Payment proof detected via Gemini Vision!`);
            
            // Lookup customer name dari PostgreSQL
            const phoneNumber = (senderJid || '').split('@')[0].replace(':', '');
            const customerDbName = getFirstName(await lookupCustomerName(phoneNumber));
            
            // Format proof analysis response
            let proofDetails = typeof proofAnalysis === 'string' ? proofAnalysis : JSON.stringify(proofAnalysis, null, 2);
            
            const proofResponse = `Terima kasih ${customerDbName || senderName}! 🙏\n\nBukti transfer Anda sudah diterima:\n\n${proofDetails}\n\nAdmin akan segera verifikasi dan mengaktifkan langganan Anda.\nMohon tunggu konfirmasi dalam beberapa saat ya! ⏳`;
            
            await sendWAMessage(chatJid, proofResponse);
            
            updateConversationHistory(phoneNumber, 'user', `[Sent IMAGE] ${senderName}`);
            updateConversationHistory(phoneNumber, 'assistant', proofResponse);
            
            console.log(`✅ Payment proof response sent to ${chatJid}`);
            return res.json({ success: true, message: 'Payment proof received and analyzed' });
          }
        } catch (e) {
          console.warn('⚠️ Payment proof analysis failed:', e.message);
          // Continue to text extraction if analysis fails
        }
      }
      
      // BARU: Extract text hanya jika BUKAN payment proof
      const extractedText = await extractTextFromImage(mediaSource);
      
      // Combine dengan caption jika ada
      if (messageText) {
        messageText = `[Gambar dikirim dengan caption: "${messageText}"]\n\nText dari gambar:\n${extractedText}`;
      } else {
        messageText = `[Gambar dikirim tanpa caption]\n\nText dari gambar:\n${extractedText}`;
      }
    }

    // Lookup customer name dari PostgreSQL
    const phoneNumber = (senderJid || '').split('@')[0].replace(':', '');
    const customerDbName = getFirstName(await lookupCustomerName(phoneNumber));
    let responseText = ''; // HARUS di awal sebelum ANY error bisa terjadi
    let knowledgeContexts = []; // Initialize early to prevent undefined errors

    console.log(`📩 Incoming message from ${customerDbName || senderName} (${senderJid}): ${messageText}`);

    // Check apakah nomor ada di override list
    if (overrideList.some(item => item.phone === phoneNumber)) {
      console.log(`⛔ Number ${phoneNumber} is in override list - skipping response`);
      return res.json({ success: true, message: 'Message skipped (override)' });
    }

    // Check if admin command (payment confirmation atau override)
    if (isAdmin(phoneNumber) && messageText.startsWith('/')) {
      // Check override command dulu
      const overrideCmd = parseOverrideCommand(messageText);
      
      if (overrideCmd) {
        console.log(`🔐 Override command detected:`, overrideCmd);
        
        // Load customer data untuk get nama
        const customerData = await loadCustomerData();
        
        // Reuse outer responseText declaration (no let here)
        
        if (overrideCmd.action === 'disable') {
          const result = await disableNumber(overrideCmd.phone, customerData);
          responseText = result.message;
        } else if (overrideCmd.action === 'enable') {
          const result = enableNumber(overrideCmd.phone);
          responseText = result.message;
        } else if (overrideCmd.action === 'list') {
          responseText = getDisabledList();
        }
        
        // Send response to admin
        await sendWAMessage(chatJid, responseText);
        
        return res.json({ success: true, message: 'Override command processed' });
      }
      
      // Check payment command
      const command = parsePaymentCommand(messageText);
      
      if (command) {
        console.log(`🔐 Admin command detected from ${phoneNumber}:`, command);
        
        // Load customer data for payment processing
        const customerData = await loadCustomerData();
        const result = await processPaymentConfirmation(command, customerData);
        
        if (typeof result === 'string') {
          // Error message
          await sendWAMessage(chatJid, result);
        } else if (result.success) {
          // Send notification to customer
          await sendWAMessage(result.customerJid, result.message);
          
          // Send confirmation to admin
          await sendWAMessage(chatJid, result.adminMessage);
        }
        
        return res.json({ success: true, message: 'Admin command processed' });
      }
    }

    // Load data
    const [pricingData, customerData, groupData] = await Promise.all([
      loadPricingData(),
      loadCustomerData(),
      loadGroupData(),
    ]);

    const availability = await checkProductAvailability(groupData, pricingData, customerData);

    const isRegisteredCustomer = isCustomer(phoneNumber, customerData);

    console.log(`👤 Customer check: ${phoneNumber} - ${isRegisteredCustomer ? 'Registered' : 'Not registered'}`);

    const trimmedMessage = messageText.trim();

    // FILTER 1: Detect DEFER/CANCEL intent (customer says "nanti", "stop", "belum", etc) - CHECK FIRST!
    const deferKeywords = ['nanti', 'stop dl', 'stop dlu', 'belum', 'blm waktunya', 'belum sekarang', 'japri lg', 'jangan sekarang', 'tidak usah', 'gak usah', 'skip', 'skip dl'];
    const isDeferring = deferKeywords.some(kw => messageText.toLowerCase().includes(kw));
    
    if (isDeferring && isRegisteredCustomer) {
      console.log(`⏸️  Customer deferring: "${trimmedMessage}"`);
      const deferResponse = `Baik ${customerDbName || senderName}, saya tunggu konfirmasi Anda nanti ya! 😊\n\nHubungi saya kapan saja jika sudah siap perpanjang. ✨`;
      
      await sendWAMessage(chatJid, deferResponse);
      
      updateConversationHistory(phoneNumber, 'user', messageText);
      updateConversationHistory(phoneNumber, 'assistant', deferResponse);
      return res.json({ success: true, message: 'Deferred response sent' });
    }

    // Get conversation history dari PostgreSQL (persistent) BEFORE any checks
    // Sehingga semua filter bisa gunakan historical context
    const conversationHistory = await getConversationHistoryPG(phoneNumber);
    if (conversationHistory.length > 0) {
      console.log(`💬 Conversation history: ${conversationHistory.length} messages (PostgreSQL)`);
    }
    
    // NEW FILTER: SMART SILENCE - Jangan respond untuk message yang terlalu pendek tanpa konteks
    // TAPI masih simpan di history (jangan kecewakan pelanggan dengan blank response)
    if (shouldSkipShortMessage(trimmedMessage, conversationHistory)) {
      console.log(`⏸️  Smart silence activated - message too short and no support context`);
      // ONLY save to history, don't send response
      updateConversationHistory(phoneNumber, 'user', messageText);
      return res.json({ success: true, message: 'Message saved but not responded (smart silence)' });
    }

    // Check apakah bot sudah tanya clarification di messages terakhir
    if (detectPreviousClarification(conversationHistory)) {
      console.log(`⚠️  WARNING: Detected previous clarification - won't ask again`);
      // This will be used in intent extraction to prevent repeat clarification
    }

    // Check conversation momentum (excessive back-and-forth)
    const badMomentum = detectConversationMomentum(conversationHistory);
    if (badMomentum) {
      console.log(`⏳ Conversation momentum disrupted - recommend minimal response`);
      // This will be used to decide response length
    }

    // Calculate product confidence untuk smart clarification
    const productConfidence = calculateProductConfidence(trimmedMessage, conversationHistory);
    console.log(`📊 Product confidence score: ${productConfidence}%`);
    
    // FILTER 2: Check if this is NEW SUBSCRIPTION request (not renewal)
    const newSubsKeywords = ['langganan baru', 'akun baru', 'daftar baru', 'bikin baru', 'buat baru', 'mau langganan'];
    const isNewSubsRequest = newSubsKeywords.some(kw => messageText.toLowerCase().includes(kw));
    
    if (isNewSubsRequest && !isRegisteredCustomer) {
      console.log(`📝 New subscription request detected - deferring to admin`);
      
      const deferMessage = `Halo ${senderName}! 👋

Terima kasih sudah berminat berlangganan. Tim admin kami akan segera memproses permintaan Anda.

Mohon tunggu sebentar ya! 🙏`;
      
      await sendWAMessage(chatJid, deferMessage);
      
      updateConversationHistory(phoneNumber, 'user', messageText);
      updateConversationHistory(phoneNumber, 'assistant', deferMessage);
      
      console.log(`✅ Deferred to admin for new subscription`);
      return res.json({ success: true, message: 'Deferred to admin' });
    }

    // Get conversation history dari PostgreSQL (persistent) — load DULU sebelum extractIntent
    // Already loaded above at line ~1825 - REMOVED DUPLICATE
    // const conversationHistory = await getConversationHistoryPG(phoneNumber); <-- REMOVED

    // Load knowledge contexts from Qdrant (with fallback to empty array)
    // Variable already declared at line ~1810
    try {
      knowledgeContexts = await searchKnowledge(messageText) || [];
    } catch (err) {
      console.warn(`⚠️ Failed to load knowledge contexts: ${err.message}`);
      knowledgeContexts = [];
    }

    // Extract intent — pass history supaya pesan pendek/ambigu bisa menggunakan konteks
    // IMPROVED: Pass confidence score untuk smart clarification (prevent over-asking)
    const intent = await extractIntent(messageText, pricingData, conversationHistory, {
      confidence: productConfidence,
      alreadyAskedClarification: detectPreviousClarification(conversationHistory),
      badMomentum: badMomentum
    });
    console.log(`🎯 Intent detected:`, intent);

    // FILTER 3: Detect vague questions and provide category overview (prevent annoying clarification)
    if (detectVagueQuestion(trimmedMessage, conversationHistory)) {
      console.log(`🎨 Vague question detected - providing category overview instead of clarification`);
      
      const customerName = isRegisteredCustomer ? (customerDbName || senderName) : senderName;
      const categoryResponse = buildCategoryOverview(customerName);
      
      await sendWAMessage(chatJid, categoryResponse);
      
      updateConversationHistory(phoneNumber, 'user', messageText);
      updateConversationHistory(phoneNumber, 'assistant', categoryResponse);
      
      console.log(`✅ Category overview sent to ${chatJid}`);
      return res.json({ success: true, message: 'Category overview sent' });
    }

    // Check if customer EXPLICITLY confirms renewal/extension (dengan strong intent)
    const confirmKeywords = ['iya perpanjang', 'mau perpanjang', 'perpanjang sekarang', 'iya lanjut', 'ok perpanjang', 'ya perpanjang', 'iya extend', 'mau bayar', 'bayar sekarang', 'bayarnya gimana', 'transfer kemana', 'rekening apa'];
    const messageTextLower = messageText.toLowerCase();
    const isConfirmingRenewal = confirmKeywords.some(keyword => messageTextLower.includes(keyword));
    
    if (isConfirmingRenewal && isRegisteredCustomer && !isDeferring) {
      console.log(`💳 Customer explicitly confirming renewal - sending payment info`);
      
      const paymentInfo = `Siap! Untuk pembayaran dapat ditransfer ke rekening:

*Bank Transfer:*
• *BCA:* 5425141373 a.n. *Suharyadi*
• *BTPN/Jenius:* 90310067177 a.n. Suharyadi
• *BSI:* 1056279373 a.n. Suharyadi
• *Bank Jago Syariah:* 502090301438 (JagoID: hary4di) a.n. *Suharyadi*

*E-Wallet:*
• OVO/GOPAY/DANA: 08128933008

Setelah transfer, mohon konfirmasi ya! 🙏🏻`;

      // Send payment info immediately
      await sendWAMessage(chatJid, paymentInfo);

      // Also update conversation and respond
      updateConversationHistory(phoneNumber, 'user', messageText);
      updateConversationHistory(phoneNumber, 'assistant', paymentInfo);
      
      console.log(`✅ Payment info sent to ${chatJid}`);
      return res.json({ success: true, message: 'Payment info sent' });
    }

    // Handle subscription_inquiry
    if (intent.intent === 'subscription_inquiry' && isRegisteredCustomer) {
      console.log(`📋 Subscription inquiry detected`);
      
      const subscriptions = await getCustomerSubscriptions(phoneNumber);
      
      if (subscriptions && subscriptions.length > 0) {
        let subscriptionList = `📋 *Langganan Anda:*\n\n`;
        subscriptions.forEach(sub => {
          subscriptionList += `${sub.statusEmoji} *${sub.product}*\n`;
          subscriptionList += `   Status: ${sub.statusText}\n`;
          subscriptionList += `   Expired: ${sub.expiry}`;
          if (sub.daysLeft > 0 && sub.daysLeft <= 7) {
            subscriptionList += ` (${sub.daysLeft} hari lagi)`;
          }
          subscriptionList += `\n`;
          if (sub.slot) {
            subscriptionList += `   Slot: ${sub.slot}/5\n`;
          }
          subscriptionList += `\n`;
        });
        
        subscriptionList += `Mau info lebih lanjut atau perpanjang? Tanya aja! 😊`;
        responseText = subscriptionList;
      } else {
        responseText = `Maaf ${customerDbName || senderName}, Anda belum punya langganan apapun. 😔\n\nMau berlangganan produk digital? Tanya-tanya aja produk apa yang tersedia! 🎯`;
      }
    }

    // ⚠️ PRIORITY CHECK: Support keywords have highest priority (override other intents)
    const supportKeywords = ['otp', 'verif', 'verifikasi', 'kode', 'login error', 'password', 'lupa', 'reset', 'error', 'gagal', 'tidak bisa', 'masalah', 'kendala', 'sudah terkirim', 'sudah terima'];
    const isNeedingSupport = supportKeywords.some(kw => messageText.toLowerCase().includes(kw));

    // Price inquiry - DIRECT TEMPLATE (NO LLM to prevent hallucination)
    // Available for BOTH registered and non-registered (conversion opportunity!)
    if (intent.intent === 'price_inquiry' && !isNeedingSupport) {
      console.log(`💰 Price inquiry detected → using DIRECT TEMPLATE (no LLM)`);

      // Stricter product filtering to avoid matching unrelated products
      const productFilter = intent.product ? intent.product.toLowerCase() : null;
      let pricingForContext = pricingData;
      
      if (productFilter) {
        const filtered = pricingData.filter(p => {
          const productLower = p.product.toLowerCase();
          const firstWord = productLower.split(' ')[0];
          
          // Strict matching: product contains filter OR filter matches first word
          return productLower.includes(productFilter) || firstWord === productFilter;
        });
        
        if (filtered.length > 0) {
          pricingForContext = filtered;
        }
      }

      // Check proactive renewal reminder untuk registered customer dengan langganan yang mau expired
      const renewalReminder = isRegisteredCustomer 
        ? await checkRenewalReminder(phoneNumber, intent.product)
        : null;

      // Direct response building - NO LLM, 100% accurate
      const customerName = isRegisteredCustomer ? (customerDbName || senderName) : senderName;
      responseText = buildPricingResponse(customerName, pricingForContext, renewalReminder);
    }

    // Availability check: hanya untuk pesan yang bukan price_inquiry/subscription_inquiry DAN hanya untuk registered customer
    // SKIP availability check untuk support requests - langsung ke LLM
    const detectedProducts = (intent.intent !== 'price_inquiry' && intent.intent !== 'subscription_inquiry' && isRegisteredCustomer && !isNeedingSupport)
      ? detectProductFromMessage(messageText, availability)
      : null;

    if (responseText) {
      // sudah di-handle di atas (price_inquiry/subscription_inquiry)
    } else if (isNeedingSupport && !responseText) {
      // Technical support request → use LLM dengan knowledge base
      console.log(`🆘 Technical support request detected`);
      responseText = await generateResponse(messageText, null, customerDbName || senderName, knowledgeContexts, conversationHistory);
    } else if (detectedProducts) {
      const productList = Array.isArray(detectedProducts) ? detectedProducts : [detectedProducts];

      // Hitung total slot tersedia dari semua matched groups
      const availableGroups = productList.filter(p => availability[p] && availability[p].available);
      const totalFreeSlots  = availableGroups.reduce((sum, p) => sum + (availability[p].totalSlots || 0), 0);

      // Nama produk bersih untuk ditampilkan ke customer (tanpa nomor/nama group internal)
      const displayName = extractProductDisplayName(productList[0]);

      if (availableGroups.length > 0) {
        responseText = `✅ *${displayName}* masih tersedia!\n\nMinat perpanjang atau berlangganan baru? Ketik "iya" atau hubungi admin! 🎯`;
      } else {
        responseText = `❌ Maaf, *${displayName}* saat ini *penuh/tidak tersedia* 🙏\n\nTunggu slot terbuka atau tanya admin untuk alternatif ya!`;
      }
    } else {
      // No product detected
      
      // For non-registered customers: keep response minimal & short to avoid unnecessary engagement
      if (!isRegisteredCustomer) {
        console.log(`📭 Non-registered customer, keeping response minimal`);
        responseText = `Terima kasih sudah menghubungi! 👋`;
      } else {
        // For registered customers: use full LLM response with knowledge base
        responseText = await generateResponse(messageText, null, customerDbName || senderName, knowledgeContexts, conversationHistory);
      }
    }

    // Save conversation ke PostgreSQL (persistent)
    await saveConversationPG(phoneNumber, messageText, responseText);

    // Kirim balasan via active provider (Fonnte or GOWA)
    await sendWAMessage(chatJid, responseText);

    console.log(`✅ Response sent to ${chatJid} via ${waAdapter.getProviderInfo().provider}`);
    res.json({ success: true, message: 'Message processed and replied' });

  } catch (error) {
    console.error('❌ Error processing inbound message:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Digilife AI Agent',
    uptime: process.uptime(),
    cache: {
      pricing: pricingCache.data.length,
      customer: customerCache.data.length,
    }
  });
});

// Check product availability endpoint
app.get('/availability', async (req, res) => {
  try {
    const pricingData = await loadPricingData();
    const groupData = await loadGroupData();
    const customerData = await loadCustomerData();
    
    const availability = await checkProductAvailability(groupData, pricingData, customerData);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      availability: availability,
      summary: formatAvailabilityInfo(availability)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Admin endpoint: Ingest knowledge document ke Qdrant
app.post('/admin/ingest-knowledge', async (req, res) => {
  try {
    const { adminPhone, adminPassword, category, topic, content } = req.body;

    // Verify admin authentication
    const cleanPhone = (adminPhone || '').replace(/[^0-9]/g, '');
    const isPhoneAdmin = cleanPhone && ADMIN_NUMBERS.some(admin => 
      admin.replace(/[^0-9]/g, '') === cleanPhone
    );
    const isPasswordAdmin = adminPassword === process.env.ADMIN_PASSWORD;

    if (!isPhoneAdmin && !isPasswordAdmin) {
      return res.status(403).json({
        success: false,
        error: '❌ Unauthorized: Invalid admin credentials'
      });
    }

    // Validate input
    if (!category || !topic || !content) {
      return res.status(400).json({
        success: false,
        error: '❌ Missing required fields: category, topic, content'
      });
    }

    if (!qdrant) {
      return res.status(503).json({
        success: false,
        error: '❌ Qdrant service unavailable'
      });
    }

    console.log(`📚 Admin ingest knowledge: [${category}] ${topic}`);

    // Generate embedding untuk content
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Create unique ID untuk document (timestamp-based)
    const docId = Date.now() + Math.floor(Math.random() * 10000);

    // Prepare payload
    const payload = {
      category: category.trim(),
      topic: topic.trim(),
      content: content.trim(),
      created_at: new Date().toISOString(),
      source: 'admin_ingest'
    };

    // Upsert point ke Qdrant
    await qdrant.upsert(COLLECTION_NAME, {
      points: [
        {
          id: docId,
          vector: embedding,
          payload: payload
        }
      ]
    });

    console.log(`✅ Knowledge ingested successfully (ID: ${docId})`);

    res.json({
      success: true,
      message: `✅ Knowledge document ingested: [${category}] ${topic}`,
      docId: docId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error ingesting knowledge:', error.message);
    res.status(500).json({
      success: false,
      error: `❌ Ingest failed: ${error.message}`
    });
  }
});

// ============================================================
// GOWA WEBHOOK ENDPOINT
// Receives messages from GOWA when WHATSAPP_PROVIDER=gowa
// GOWA v8.3.0 webhook payload format:
// { event: "message", data: { from, pushName, body, type, device_id, media: { url, mime_type } } }
// ============================================================
app.post('/api/webhook/gowa', async (req, res) => {
  try {
    console.log(`📩 GOWA webhook received:`, JSON.stringify(req.body, null, 2).substring(0, 400));

    const { event, payload } = req.body;

    // Only process incoming messages (ignore ack, call.offer, etc.)
    if (!event || event !== 'message') {
      return res.json({ success: true, message: `Event '${event}' ignored` });
    }

    if (!payload || !payload.from) {
      return res.status(400).json({ success: false, message: 'Invalid GOWA payload: missing payload.from' });
    }

    // Skip messages sent BY the bot (our own outgoing messages)
    const botJid = process.env.GOWA_BOT_JID || '62818135019@s.whatsapp.net';
    if (payload.from === botJid || payload.from_me === true) {
      return res.json({ success: true, message: 'Own message ignored' });
    }

    // -----------------------------------------------
    // GOWA v8.3.0 actual payload fields:
    //   payload.from         → sender JID
    //   payload.chat_id      → chat JID (group or individual)
    //   payload.from_name    → sender display name
    //   payload.text         → text message content
    //   payload.image        → relative path e.g. "statics/media/xxx.jpg"
    //   payload.video        → relative path for video
    //   payload.audio        → relative path for audio
    //   payload.caption      → caption of image/video (if any)
    // -----------------------------------------------
    const gowaBaseUrl = process.env.GOWA_API_URL || 'http://localhost:3006';

    // Build full URL for media (relative path → absolute)
    let mediaUrl = null;
    if (payload.image) {
      // "statics/media/xxx.jpg" → "http://localhost:3006/statics/media/xxx.jpg"
      mediaUrl = `${gowaBaseUrl}/${payload.image}`;
    } else if (payload.video) {
      mediaUrl = `${gowaBaseUrl}/${payload.video}`;
    } else if (payload.audio) {
      mediaUrl = `${gowaBaseUrl}/${payload.audio}`;
    }

    // Text: combine caption + text (image may have caption as separate field)
    const messageText = payload.caption || payload.text || '';

    const inboundPayload = {
      senderJid: payload.from,
      chatJid:   payload.chat_id || payload.from,
      senderName: payload.from_name || payload.from.split('@')[0],
      text: messageText,
      // Media fields (picked up by /inbound image handler)
      ...(mediaUrl && { imageUrl: mediaUrl, mimeType: payload.mime_type || 'image/jpeg' }),
    };

    console.log(`📩 GOWA → /inbound: from=${inboundPayload.senderJid} text="${messageText.substring(0, 50)}" media=${mediaUrl ? '✅' : '❌'}`);

    // Forward to /inbound handler (same business logic for both Fonnte and GOWA)
    const inboundResponse = await axios.post(
      `http://localhost:${PORT}/inbound`,
      inboundPayload
    );

    res.json(inboundResponse.data);
  } catch (error) {
    console.error('❌ GOWA webhook error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// ADMIN: WhatsApp Provider Management
// ============================================================

// Switch provider at runtime (no restart needed)
app.post('/api/admin/switch-provider', (req, res) => {
  try {
    const { provider, adminPassword } = req.body;

    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    if (!['fonnte', 'gowa'].includes(provider)) {
      return res.status(400).json({ success: false, error: 'Provider must be "fonnte" or "gowa"' });
    }

    waAdapter.switchProvider(provider);
    console.log(`🔄 Provider switched to ${provider.toUpperCase()} by admin`);

    res.json({
      success: true,
      message: `✅ WhatsApp provider switched to ${provider.toUpperCase()}`,
      provider: provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current provider status
app.get('/api/admin/provider-status', async (req, res) => {
  try {
    const info = waAdapter.getProviderInfo();
    const status = await waAdapter.getStatus();

    res.json({
      success: true,
      ...info,
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Digilife AI Agent running on port ${PORT}`);
  
  // Pre-load data saat startup
  console.log('📊 Pre-loading data from PostgreSQL...');
  await loadPricingData();
  await loadCustomerData();
  console.log('✅ Data pre-loaded successfully');
  
  // Load override list
  await loadOverrideList();
});
