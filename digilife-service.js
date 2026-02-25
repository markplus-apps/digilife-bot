// Digilife AI Agent Service
// AI-powered chatbot untuk menjawab pertanyaan produk digital subscription

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');
const NodeCache = require('node-cache');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3010/send-message'; // Fixed: Bot runs on 3010, not 3000

// Admin config untuk payment confirmation
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '628128933008').split(',').map(n => n.trim());

// OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Qdrant Setup untuk Vector DB
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

// Fungsi untuk OCR gambar menggunakan GPT-4o-mini Vision
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
                detail: 'low' // low = cheaper, cukup untuk text extraction
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

async function extractIntent(userMessage, pricingData, conversationHistory = []) {
  const productList = [...new Set(pricingData.map(p => p.product))].join(', ');

  // Build history context string (last 4 messages) supaya pesan pendek bisa dipahami dalam konteks
  let historyContext = '';
  if (conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-4);
    historyContext = `\n\nHistory percakapan sebelumnya (gunakan sebagai konteks):\n` +
      recent.map(m => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content.substring(0, 150)}`).join('\n');
  }
  
  const prompt = `Analisa pertanyaan customer service ini dan kategorisasi:

Produk tersedia: ${productList}${historyContext}

Pesan terbaru customer: "${userMessage}"

PERHATIAN: Gunakan history di atas sebagai konteks. Contoh: jika history bicara soal YouTube Premium dan pesan baru adalah "bayarnya gimana?" atau "transfer kemana?", itu adalah intent "renewal" dengan product "YouTube Premium".

Kategori intent:
1. **troubleshooting** - Masalah OTP, password, login, akun error → {"intent": "support"}
2. **renewal** - Mau perpanjang langganan, tanya cara bayar, transfer, konfirmasi bayar → {"intent": "renewal", "product": "nama produk dari history jika tidak disebutkan"}
3. **price_inquiry** - Tanya harga spesifik → extract product & duration
4. **availability_inquiry** - Tanya apakah produk tersedia/ada slot/ready/kosong/full ("ada?", "ready?", "ada slot?", "masih ada?", "kosong gak?") → {"intent": "availability_inquiry", "product": "nama produk"}
5. **product_info** - Tanya "basic/premium/family", "ada apa aja", kategori produk → {"intent": "product_catalog"}
6. **greeting** - Halo, hi, salam → {"intent": "greeting"}

Response format JSON:
{
  "intent": "support" | "renewal" | "price_inquiry" | "availability_inquiry" | "product_catalog" | "greeting" | "unclear",
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

// Fungsi untuk generate response menggunakan LLM dengan RAG
async function generateResponse(userMessage, pricingResult, customerName = null, knowledgeContexts = [], conversationHistory = []) {
  let systemPrompt = `Kamu adalah CS support untuk layanan subscription produk digital (Netflix, YouTube Premium, Disney+, Spotify, dll).
Prioritas: SUPPORT CUSTOMER, bukan jualan. Customer biasanya menanyakan:
1. Kendala teknis (OTP login, password, akun bermasalah)
2. Perpanjangan langganan yang akan expired
3. Jarang yang tanya harga duluan

⚠️ IMPORTANT - KAPAN HARUS DEFER KE ADMIN:
- Jika customer request langganan BARU (bukan perpanjangan) DAN belum tahu harga/produk → Bilang "Tim admin akan proses"
- ⚠️ JANGAN defer jika customer HANYA tanya harga atau cek ketersediaan slot — itu bukan new subscription request
- ⚠️ JANGAN defer jika customer bilang "ada slot?", "ready?", "available?", "berapa harga?" — jawab langsung dari data
- Jika pertanyaan TIDAK JELAS atau AMBIGUOUS → Jangan tebak-tebak, bilang "Bisa dijelaskan lebih detail?"
- Jika conversation sudah melibatkan ADMIN (lihat conversation history) → Jangan interrupt, respond minimal
- Jika customer konfirmasi pembayaran/transfer → Bilang "Terima kasih, admin akan cek konfirmasi pembayaran"
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
3. Format harga promo: ~Rp 76.000~ *Rp 70.000* (WhatsApp strikethrough & bold, JANGAN tulis kata "coret")
4. ⛔ DILARANG KERAS mengarang atau menghitung harga — hanya tampilkan harga yang ADA PERSIS di KNOWLEDGE BASE
5. ⛔ DILARANG menampilkan durasi yang TIDAK ADA di KNOWLEDGE BASE (contoh: jangan tulis "12 bulan" jika tidak ada di list)
6. Jika durasi yang ditanya tidak ada di data → jawab "Untuk durasi tersebut belum tersedia ka, tersedia [sebutkan hanya yang ada]"
7. Kalau tidak jelas, tanya spesifik: "Untuk produk apa kak? Netflix, YouTube, atau yang lain?"`;

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
      userPrompt += `\n\nGunakan data harga dari KNOWLEDGE BASE di atas untuk menjawab. Tampilkan semua durasi yang relevan. Format harga: *Rp X.XXX* (bold). Response harus natural, jangan robotic!`;
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
    const { senderJid, senderName, chatJid, text, imageUrl, media, isGroup } = req.body;

    let messageText = text || '';
    const mediaSource = imageUrl || media || null;

    // Jika ada gambar, extract text dari gambar menggunakan GPT-4o-mini Vision
    if (mediaSource) {
      console.log(`📩 Incoming IMAGE from ${senderName} (${senderJid})`);
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
    const customerDbName = await lookupCustomerName(phoneNumber);

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
        
        let responseText = '';
        
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
        await axios.post(BOT_API_URL, {
          to: chatJid,
          text: responseText,
        });
        
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
          await axios.post(BOT_API_URL, {
            to: chatJid,
            text: result,
          });
        } else if (result.success) {
          // Send notification to customer
          await axios.post(BOT_API_URL, {
            to: result.customerJid,
            text: result.message,
          });
          
          // Send confirmation to admin
          await axios.post(BOT_API_URL, {
            to: chatJid,
            text: result.adminMessage,
          });
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

    const isRegisteredCustomer = isCustomer(phoneNumber, customerData);

    console.log(`👤 Customer check: ${phoneNumber} - ${isRegisteredCustomer ? 'Registered' : 'Not registered'}`);

    // FILTER 1: Skip auto-reply untuk message yang terlalu pendek/ambiguous
    const trimmedMessage = messageText.trim();
    const shortAmbiguousKeywords = [
      'ok', 'oke', 'baik', 'siap', 'ya', 'iya', 'tidak', 'nggak', 'gak', 'ngga', 'ga',
      'blm', 'belum', 'sdh', 'sudah', 'udah', 'mau', 'boleh', 'bisa', 'bisa'
    ];
    
    const isShortMessage = trimmedMessage.length < 15;
    const isAmbiguous = shortAmbiguousKeywords.some(kw => trimmedMessage.toLowerCase() === kw);
    const isOnlyNumbers = /^[\d\s.,]+$/.test(trimmedMessage); // Only digits, spaces, dots, commas
    
    if (isShortMessage && (isAmbiguous || isOnlyNumbers)) {
      console.log(`⏭️  Skipping auto-reply: Message too short/ambiguous: "${trimmedMessage}"`);
      
      // Only update history, don't respond
      updateConversationHistory(phoneNumber, 'user', messageText);
      return res.json({ success: true, message: 'Message logged (too ambiguous, manual handling suggested)' });
    }
    
    // FILTER 2: Check if this is NEW SUBSCRIPTION request (not renewal)
    const newSubsKeywords = ['langganan baru', 'akun baru', 'daftar baru', 'bikin baru', 'buat baru', 'mau langganan'];
    const isNewSubsRequest = newSubsKeywords.some(kw => messageText.toLowerCase().includes(kw));
    
    if (isNewSubsRequest && !isRegisteredCustomer) {
      console.log(`📝 New subscription request detected - deferring to admin`);
      
      const deferMessage = `Halo ${senderName}! 👋

Terima kasih sudah berminat berlangganan. Tim admin kami akan segera memproses permintaan Anda.

Mohon tunggu sebentar ya! 🙏`;
      
      await axios.post(BOT_API_URL, {
        to: chatJid,
        text: deferMessage,
      });
      
      updateConversationHistory(phoneNumber, 'user', messageText);
      updateConversationHistory(phoneNumber, 'assistant', deferMessage);
      
      console.log(`✅ Deferred to admin for new subscription`);
      return res.json({ success: true, message: 'Deferred to admin' });
    }

    // Get conversation history dari PostgreSQL (persistent) — load DULU sebelum extractIntent
    const conversationHistory = await getConversationHistoryPG(phoneNumber);
    if (conversationHistory.length > 0) {
      console.log(`💬 Conversation history: ${conversationHistory.length} messages (PostgreSQL)`);
    }

    // Extract intent — pass history supaya pesan pendek/ambigu bisa menggunakan konteks
    const intent = await extractIntent(messageText, pricingData, conversationHistory);
    console.log(`🎯 Intent detected:`, intent);

    // Check if customer confirms renewal/extension
    const confirmKeywords = ['iya perpanjang', 'mau perpanjang', 'perpanjang', 'iya lanjut', 'ok perpanjang', 'ya perpanjang', 'iya extend', 'mau bayar', 'bayar sekarang'];
    const messageTextLower = messageText.toLowerCase();
    const isConfirmingRenewal = confirmKeywords.some(keyword => messageTextLower.includes(keyword));
    
    if (isConfirmingRenewal && isRegisteredCustomer) {
      console.log(`💳 Customer confirming renewal - sending payment info`);
      
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
      await axios.post(BOT_API_URL, {
        to: chatJid,
        text: paymentInfo,
      });

      // Also update conversation and respond
      updateConversationHistory(phoneNumber, 'user', messageText);
      updateConversationHistory(phoneNumber, 'assistant', paymentInfo);
      
      console.log(`✅ Payment info sent to ${chatJid}`);
      return res.json({ success: true, message: 'Payment info sent' });
    }

    // Search knowledge dari Vector DB untuk RAG
    const knowledgeContexts = await searchKnowledge(messageText, 3);

    // Check product availability
    const availability = await checkProductAvailability(groupData, pricingData, customerData);

    let responseText = '';

    // Jika intent adalah price_inquiry → LANGSUNG ke GPT, jangan intercept dengan availability check
    // Ini mencegah "berapa harga netflix?" dijawab dengan FULL/KOSONG
    if (intent.intent === 'price_inquiry') {
      console.log(`💰 Price inquiry detected → routing to GPT with full pricing data`);

      // Build pricing context dari pricingData — filter by product jika intent.product diketahui
      const productFilter = intent.product ? intent.product.toLowerCase() : null;
      let pricingForContext = pricingData;
      if (productFilter) {
        const filtered = pricingData.filter(p =>
          p.product.toLowerCase().includes(productFilter) ||
          productFilter.includes(p.product.toLowerCase().split(' ')[0])
        );
        if (filtered.length > 0) pricingForContext = filtered;
      }

      const pricingContextContent = pricingForContext.map(p => {
        const hargaPromo = `Rp ${p.price.toLocaleString('id-ID')}`;
        if (p.price_normal > 0 && p.price_normal > p.price) {
          const hargaNormal = `Rp ${p.price_normal.toLocaleString('id-ID')}`;
          return `- ${p.product} ${p.duration}: ${hargaNormal} → PROMO ${hargaPromo}`;
        }
        return `- ${p.product} ${p.duration}: ${hargaPromo}`;
      }).join('\n');

      const pricingKnowledge = {
        category: 'PRICING',
        topic: 'Daftar harga produk DigiLife — INI ADALAH DATA LENGKAP. JANGAN tambahkan durasi atau harga yang tidak ada di list ini.',
        content: pricingContextContent + '\n\n⚠️ HANYA tampilkan entri di atas. Durasi yang tidak tercantum = tidak tersedia.',
      };

      const enrichedKnowledgeContexts = [pricingKnowledge, ...knowledgeContexts];
      responseText = await generateResponse(messageText, null, customerDbName || senderName, enrichedKnowledgeContexts, conversationHistory);
    }

    // Availability check: hanya untuk pesan yang bukan price_inquiry
    const detectedProducts = intent.intent !== 'price_inquiry'
      ? detectProductFromMessage(messageText, availability)
      : null;

    if (responseText) {
      // sudah di-handle di atas (price_inquiry)
    } else if (detectedProducts) {
      // Handle case dimana ada multiple variants (array)
      const productList = Array.isArray(detectedProducts) ? detectedProducts : [detectedProducts];
      // firstProduct is already sorted: available products first
      const firstProduct = Array.isArray(detectedProducts) ? detectedProducts[0] : detectedProducts;
      const availabilityStatus = availability[firstProduct];
      
      if (availabilityStatus.available) {
        responseText = `✅ *${firstProduct}* TERSEDIA!

Minat? Ketik "iya" atau hub admin! 🎯`;
        
        // If there are multiple variants, mention them
        if (productList.length > 1) {
          const otherVariants = productList.slice(1).filter(p => !availability[p].available);
          if (otherVariants.length > 0) {
            responseText += `\n\n(Varian lain: ${otherVariants.join(', ')} saat ini kosong)`;
          }
        }
      } else {
        // Semua kosong
        responseText = `❌ Maaf, *${firstProduct}* saat ini **FULL/KOSONG** 🙏

Tunggu slot terbuka atau tanya admin untuk alternatif!`;
        
        // If there are multiple variants, check if any is available
        if (productList.length > 1) {
          const availableVariants = productList.filter(p => availability[p].available);
          if (availableVariants.length > 0) {
            responseText = `✅ *${availableVariants[0]}* TERSEDIA!

Minat? Ketik "iya" atau hub admin! 🎯`;
            if (availableVariants.length > 1) {
              responseText += `\n\nVarian lain tersedia: ${availableVariants.slice(1).join(', ')}`;
            }
          }
        }
      }
    } else {
      // No product detected - use LLM for general response
      responseText = await generateResponse(messageText, null, customerDbName || senderName, knowledgeContexts, conversationHistory);
    }

    // Save conversation ke PostgreSQL (persistent)
    await saveConversationPG(phoneNumber, messageText, responseText);

    // Kirim balasan via bot-1
    await axios.post(BOT_API_URL, {
      to: chatJid,
      text: responseText,
    });

    console.log(`✅ Response sent to ${chatJid}`);
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
