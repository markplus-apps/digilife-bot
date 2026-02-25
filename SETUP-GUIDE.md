# 🚀 DIGILIFE DASHBOARD - SETUP GUIDE

## ✅ Prerequisites (Sudah Ready)
- ✅ PostgreSQL di VPS (145.79.10.104)
- ✅ GitHub Repo: https://github.com/markplus-apps/digilife.git
- ✅ Domain sudah dimiliki
- ✅ Database credentials:
  - Database: `digilifedb`
  - User: `digilife_user`
  - Password: `MasyaAllah26`

---

## 📋 STEP-BY-STEP SETUP

### **STEP 1: Setup PostgreSQL Database**

#### 1.1. SSH ke VPS
```bash
ssh root@145.79.10.104
```

#### 1.2. Masuk ke PostgreSQL
```bash
# Login as postgres user
sudo -u postgres psql
```

#### 1.3. Create Database & User
```sql
-- Create user
CREATE USER digilife_user WITH PASSWORD 'MasyaAllah26';

-- Create database
CREATE DATABASE digilifedb OWNER digilife_user;

-- Grant all privileges
GRANT ALL PRIVILEGES ON DATABASE digilifedb TO digilife_user;

-- Connect to database
\c digilifedb

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO digilife_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO digilife_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO digilife_user;

-- Enable UUID extension (needed for unique IDs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm extension (needed for full-text search)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Exit
\q
```

#### 1.4. Test Connection
```bash
# Test connection
psql -U digilife_user -d digilifedb -h localhost

# If successful, you'll see:
# digilifedb=>

# Test query
SELECT version();

# Exit
\q
```

#### 1.5. Configure PostgreSQL for Remote Access (Jika perlu akses dari luar VPS)

**Edit postgresql.conf:**
```bash
# Find config file
sudo -u postgres psql -c "SHOW config_file;"

# Edit (biasanya di /etc/postgresql/XX/main/postgresql.conf)
sudo nano /etc/postgresql/14/main/postgresql.conf

# Find and change:
listen_addresses = '*'  # atau 'localhost,145.79.10.104'
```

**Edit pg_hba.conf:**
```bash
sudo nano /etc/postgresql/14/main/pg_hba.conf

# Add line (adjust IP sesuai kebutuhan):
# Allow from localhost
host    digilifedb    digilife_user    127.0.0.1/32    md5

# Allow from specific IP (optional, for remote access)
# host    digilifedb    digilife_user    0.0.0.0/0    md5
```

**Restart PostgreSQL:**
```bash
sudo systemctl restart postgresql
sudo systemctl status postgresql
```

---

### **STEP 2: Create Database Schema**

#### 2.1. Create Migration File
```bash
# Create migrations directory
mkdir -p ~/Digilife/database/migrations

# Create initial migration
nano ~/Digilife/database/migrations/001_initial_schema.sql
```

#### 2.2. Copy this SQL Schema:
```sql
-- 001_initial_schema.sql
-- Digilife Dashboard Database Schema
-- Created: 2026-02-22

-- =============================================
-- TABLE: users (Admin authentication)
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'cs', 'viewer')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast email lookup
CREATE INDEX idx_users_email ON users(email);

-- =============================================
-- TABLE: customers
-- =============================================
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(255) NOT NULL,
  produk VARCHAR(255),
  wa_pelanggan VARCHAR(20) UNIQUE NOT NULL,
  subscription VARCHAR(255),
  member_since DATE,
  start_membership DATE,
  end_membership DATE,
  status_payment VARCHAR(20) CHECK (status_payment IN ('PAID', 'UNPAID', 'PENDING', 'CANCELLED')),
  extension_payment VARCHAR(255),
  keterangan VARCHAR(255), -- TERM
  slot INTEGER,
  sisa_hari INTEGER,
  hari_lepas INTEGER,
  reminder_cluster VARCHAR(10),
  reminded_h5 TIMESTAMPTZ,
  reminded_h1 TIMESTAMPTZ,
  email VARCHAR(255),
  profil_pin VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_customers_wa ON customers(wa_pelanggan);
CREATE INDEX idx_customers_produk ON customers(produk);
CREATE INDEX idx_customers_status ON customers(status_payment);
CREATE INDEX idx_customers_end_membership ON customers(end_membership);
CREATE INDEX idx_customers_subscription ON customers(subscription);

-- Full-text search index
CREATE INDEX idx_customers_nama_search ON customers USING gin(nama gin_trgm_ops);

-- =============================================
-- TABLE: groups (Account groups)
-- =============================================
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  subscription VARCHAR(255) UNIQUE NOT NULL, -- Group name
  code VARCHAR(100),
  email VARCHAR(255), -- For most products: email, For Disney+: phone number
  password VARCHAR(255), -- For most: password, For Spotify: profile name only
  link VARCHAR(500),
  profile_name VARCHAR(255),
  max_slots INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_groups_subscription ON groups(subscription);

-- =============================================
-- TABLE: pricing
-- =============================================
CREATE TABLE IF NOT EXISTS pricing (
  id SERIAL PRIMARY KEY,
  product VARCHAR(255) NOT NULL,
  duration VARCHAR(50) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_pricing_product ON pricing(product);
CREATE INDEX idx_pricing_active ON pricing(is_active);

-- =============================================
-- TABLE: payments (Payment history)
-- =============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  product VARCHAR(255) NOT NULL,
  duration VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payment_method VARCHAR(50),
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_payments_date ON payments(payment_date);

-- =============================================
-- TABLE: conversations (WhatsApp chat logs)
-- =============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  wa_number VARCHAR(20) NOT NULL,
  message_type VARCHAR(20) CHECK (message_type IN ('incoming', 'outgoing')),
  message_text TEXT,
  intent VARCHAR(100),
  sentiment VARCHAR(20),
  is_handled_by_bot BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_conversations_customer ON conversations(customer_id);
CREATE INDEX idx_conversations_wa ON conversations(wa_number);
CREATE INDEX idx_conversations_date ON conversations(created_at);

-- =============================================
-- TABLE: activity_logs (Audit trail)
-- =============================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id VARCHAR(100),
  description TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_date ON activity_logs(created_at);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);

-- =============================================
-- TABLE: settings (System settings)
-- =============================================
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Function: Update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pricing_updated_at
  BEFORE UPDATE ON pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function: Calculate sisa_hari automatically
CREATE OR REPLACE FUNCTION update_sisa_hari()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_membership IS NOT NULL THEN
    NEW.sisa_hari = GREATEST(0, EXTRACT(DAY FROM (NEW.end_membership - CURRENT_DATE))::INTEGER);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for sisa_hari
CREATE TRIGGER update_customers_sisa_hari
  BEFORE INSERT OR UPDATE OF end_membership ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_sisa_hari();

-- =============================================
-- INITIAL DATA: Admin User
-- =============================================

-- Create default admin user
-- Password: 'admin123' (CHANGE THIS IMMEDIATELY!)
-- Hash generated using bcrypt with 10 rounds
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES (
  'admin@digilife.com',
  '$2a$10$YourHashedPasswordHere', -- WILL BE GENERATED BY APP
  'System Administrator',
  'admin',
  true
) ON CONFLICT (email) DO NOTHING;

-- =============================================
-- VIEWS: Helpful views for dashboard
-- =============================================

-- View: Customer summary with days remaining
CREATE OR REPLACE VIEW v_customer_summary AS
SELECT 
  c.id,
  c.nama,
  c.produk,
  c.wa_pelanggan,
  c.subscription,
  c.email,
  c.status_payment,
  c.end_membership,
  CASE 
    WHEN c.end_membership IS NULL THEN NULL
    WHEN c.end_membership < CURRENT_DATE THEN 0
    ELSE EXTRACT(DAY FROM (c.end_membership - CURRENT_DATE))::INTEGER
  END as sisa_hari,
  CASE 
    WHEN c.end_membership IS NULL THEN 'no_expiry'
    WHEN c.end_membership < CURRENT_DATE THEN 'expired'
    WHEN c.end_membership <= CURRENT_DATE + INTERVAL '1 day' THEN 'h1'
    WHEN c.end_membership <= CURRENT_DATE + INTERVAL '5 days' THEN 'h5'
    WHEN c.end_membership <= CURRENT_DATE + INTERVAL '7 days' THEN 'h7'
    ELSE 'active'
  END as reminder_status,
  c.created_at,
  c.updated_at
FROM customers c;

-- View: Group utilization
CREATE OR REPLACE VIEW v_group_utilization AS
SELECT 
  g.id,
  g.subscription,
  g.max_slots,
  COUNT(c.id) as used_slots,
  (g.max_slots - COUNT(c.id)) as available_slots,
  ROUND((COUNT(c.id)::DECIMAL / NULLIF(g.max_slots, 0)) * 100, 2) as utilization_percent
FROM groups g
LEFT JOIN customers c ON c.subscription = g.subscription AND c.status_payment = 'PAID'
GROUP BY g.id, g.subscription, g.max_slots;

-- View: Revenue summary
CREATE OR REPLACE VIEW v_revenue_summary AS
SELECT 
  DATE_TRUNC('month', payment_date) as month,
  product,
  COUNT(*) as transaction_count,
  SUM(amount) as total_revenue
FROM payments
GROUP BY DATE_TRUNC('month', payment_date), product
ORDER BY month DESC, total_revenue DESC;

-- =============================================
-- COMPLETE!
-- =============================================
```

#### 2.3. Run Migration
```bash
# Run migration
psql -U digilife_user -d digilifedb -h localhost -f ~/Digilife/database/migrations/001_initial_schema.sql

# Verify tables created
psql -U digilife_user -d digilifedb -h localhost -c "\dt"

# You should see:
# customers, groups, pricing, users, payments, conversations, activity_logs, settings
```

---

### **STEP 3: Migrate Data from Google Sheets**

#### 3.1. Create Migration Script
```bash
nano ~/Digilife/database/migrate-from-sheets.js
```

#### 3.2. Migration Script Content:
```javascript
// migrate-from-sheets.js
require('dotenv').config();
const { google } = require('googleapis');
const { Pool } = require('pg');

// PostgreSQL connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'digilifedb',
  user: 'digilife_user',
  password: 'MasyaAllah26'
});

// Google Sheets config
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // GANTI INI

async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return auth.getClient();
}

async function migrateCustomers() {
  console.log('📊 Migrating customers from Google Sheets...');
  
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Customer!A:Q',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) {
    console.log('❌ No data found');
    return;
  }

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    const customer = {
      nama: row[1] || null,
      produk: row[2] || null,
      wa_pelanggan: row[3] ? row[3].replace(/[^0-9]/g, '') : null,
      subscription: row[4] || null,
      member_since: row[5] || null,
      start_membership: row[6] || null,
      end_membership: row[7] || null,
      status_payment: row[8] || 'UNPAID',
      extension_payment: row[9] || null,
      keterangan: row[10] || null,
      slot: row[11] ? parseInt(row[11]) : null,
      sisa_hari: row[12] ? parseInt(row[12]) : null,
      hari_lepas: row[13] ? parseInt(row[13]) : null,
      reminder_cluster: row[14] || null,
      reminded_h5: row[15] || null,
      reminded_h1: row[16] || null,
      email: row[17] || null,
      profil_pin: row[4] || null, // Column E from Customer sheet
    };

    // Skip if no phone number
    if (!customer.wa_pelanggan) continue;

    try {
      await pool.query(`
        INSERT INTO customers (
          nama, produk, wa_pelanggan, subscription, 
          member_since, start_membership, end_membership, 
          status_payment, extension_payment, keterangan, 
          slot, sisa_hari, hari_lepas, reminder_cluster, 
          reminded_h5, reminded_h1, email, profil_pin
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (wa_pelanggan) DO UPDATE SET
          nama = EXCLUDED.nama,
          produk = EXCLUDED.produk,
          subscription = EXCLUDED.subscription,
          end_membership = EXCLUDED.end_membership,
          status_payment = EXCLUDED.status_payment,
          updated_at = NOW()
      `, [
        customer.nama, customer.produk, customer.wa_pelanggan, customer.subscription,
        customer.member_since, customer.start_membership, customer.end_membership,
        customer.status_payment, customer.extension_payment, customer.keterangan,
        customer.slot, customer.sisa_hari, customer.hari_lepas, customer.reminder_cluster,
        customer.reminded_h5, customer.reminded_h1, customer.email, customer.profil_pin
      ]);

      console.log(`   ✅ ${customer.nama} (${customer.wa_pelanggan})`);
    } catch (error) {
      console.error(`   ❌ Error migrating ${customer.nama}:`, error.message);
    }
  }

  console.log('✅ Customer migration complete!');
}

async function migrateGroups() {
  console.log('📊 Migrating groups from Google Sheets...');
  
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Group!A:F',
  });

  const rows = response.data.values || [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    const group = {
      subscription: row[1] || null,
      code: row[2] || null,
      email: row[3] || null,
      password: row[4] || null,
      link: row[5] || null,
      profile_name: row[5] || null,
    };

    if (!group.subscription) continue;

    try {
      await pool.query(`
        INSERT INTO groups (subscription, code, email, password, link, profile_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (subscription) DO UPDATE SET
          email = EXCLUDED.email,
          password = EXCLUDED.password,
          updated_at = NOW()
      `, [group.subscription, group.code, group.email, group.password, group.link, group.profile_name]);

      console.log(`   ✅ ${group.subscription}`);
    } catch (error) {
      console.error(`   ❌ Error migrating ${group.subscription}:`, error.message);
    }
  }

  console.log('✅ Group migration complete!');
}

async function migratePricing() {
  console.log('📊 Migrating pricing from Google Sheets...');
  
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Pricing!A:F',
  });

  const rows = response.data.values || [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    const pricing = {
      product: row[1] || null,
      duration: row[2] || null,
      price: row[3] ? parseFloat(row[3].replace(/[^0-9.-]/g, '')) : 0,
      description: row[4] || null,
      category: row[5] || null,
    };

    if (!pricing.product) continue;

    try {
      await pool.query(`
        INSERT INTO pricing (product, duration, price, description, category)
        VALUES ($1, $2, $3, $4, $5)
      `, [pricing.product, pricing.duration, pricing.price, pricing.description, pricing.category]);

      console.log(`   ✅ ${pricing.product} - ${pricing.duration}`);
    } catch (error) {
      console.error(`   ❌ Error migrating pricing:`, error.message);
    }
  }

  console.log('✅ Pricing migration complete!');
}

async function main() {
  console.log('🚀 Starting data migration...\n');
  
  try {
    await migrateCustomers();
    console.log('');
    await migrateGroups();
    console.log('');
    await migratePricing();
    console.log('\n✅ ALL DATA MIGRATED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
  }
}

main();
```

#### 3.3. Install Dependencies & Run Migration
```bash
cd ~/Digilife
npm install pg googleapis dotenv

# Copy Google credentials
# (yang sudah ada di current setup)
cp google-credentials.json ~/Digilife/database/

# Edit script dengan Spreadsheet ID yang benar
nano ~/Digilife/database/migrate-from-sheets.js
# Ganti: const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';

# Run migration
node ~/Digilife/database/migrate-from-sheets.js
```

---

### **STEP 4: Initialize Next.js Project**

#### 4.1. Di Local Machine (Windows)
```powershell
# Open PowerShell di folder project
cd "C:\Users\hp\OneDrive - MarkPlus Indonesia ,PT\MARKPLUS\Automation\Ai Agent"

# Create Next.js project
npx create-next-app@latest digilife-dashboard --typescript --tailwind --app --src-dir --import-alias "@/*"

cd digilife-dashboard

# Install dependencies
npm install @tanstack/react-query zustand
npm install pg
npm install bcrypt jsonwebtoken
npm install zod react-hook-form @hookform/resolvers
npm install date-fns
npm install lucide-react
npm install recharts
npm install socket.io-client

# Install shadcn/ui
npx shadcn-ui@latest init

# When prompted:
# - Would you like to use TypeScript? Yes
# - Which style would you like to use? Default
# - Which color would you like to use as base color? Slate
# - Where is your global CSS file? src/app/globals.css
# - Would you like to use CSS variables for colors? Yes
# - Would you like to use React Server Components? Yes
# - Write configuration to components.json? Yes

# Install shadcn components
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add table
npx shadcn-ui@latest add form
npx shadcn-ui@latest add input
npx shadcn-ui@latest add label
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add dropdown-menu
npx shadcn-ui@latest add select
npx shadcn-ui@latest add toast
npx shadcn-ui@latest add badge
npx shadcn-ui@latest add avatar
npx shadcn-ui@latest add separator
npx shadcn-ui@latest add tabs
```

#### 4.2. Create .env.local
```powershell
# Create environment variables file
New-Item .env.local

# Edit .env.local
notepad .env.local
```

Add this content:
```env
# Database
DATABASE_URL=postgresql://digilife_user:MasyaAllah26@145.79.10.104:5432/digilifedb

# JWT Secret (generate random string)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# WhatsApp Bot API
WHATSAPP_BOT_URL=http://145.79.10.104:3010/send-message

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Node environment
NODE_ENV=development
```

---

### **STEP 5: Connect to GitHub**

```powershell
# Initialize git (if not already)
git init

# Create .gitignore (Next.js default + custom)
@"
# Dependencies
node_modules/
.pnpm-store/

# Next.js
.next/
out/
build/
dist/

# Environment variables
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Testing
coverage/
.nyc_output/

# Misc
.vercel
"@ | Out-File -FilePath .gitignore -Encoding utf8

# Add remote
git remote add origin https://github.com/markplus-apps/digilife.git

# Add all files
git add .

# Initial commit
git commit -m "Initial commit: Next.js dashboard setup"

# Push to GitHub
git push -u origin main
```

---

### **STEP 6: Create Basic Dashboard Structure**

#### 6.1. Create Database Connection Utility

Create file: `src/lib/db.ts`
```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export default pool;
```

#### 6.2. Create Auth Utilities

Create file: `src/lib/auth.ts`
```typescript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: any): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}
```

#### 6.3. Create API Route: Login

Create file: `src/app/api/auth/login/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword, generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Find user
    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Generate token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Return user data (without password)
    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

#### 6.4. Create Login Page

Create file: `src/app/(auth)/login/page.tsx`
```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      // Save token to localStorage
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Redirect to dashboard
      router.push('/dashboard');
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>
            Sign in to your Digilife Dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@digilife.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="text-sm text-red-500">{error}</div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

### **STEP 7: Test Locally**

```powershell
# Start development server
npm run dev

# Open browser
# http://localhost:3000/login

# Default credentials (akan dibuat di database):
# Email: admin@digilife.com
# Password: admin123
```

---

### **STEP 8: Deploy to Production**

#### Option A: Deploy to Vercel (Recommended)

```powershell
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Follow prompts:
# - Link to existing project? No
# - Project name: digilife-dashboard
# - Directory: ./
# - Override settings? No

# Add environment variables in Vercel dashboard:
# https://vercel.com/your-username/digilife-dashboard/settings/environment-variables
# Add: DATABASE_URL, JWT_SECRET, WHATSAPP_BOT_URL
```

#### Option B: Deploy to VPS (Manual)

```bash
# On VPS
cd /var/www
mkdir digilife-dashboard
cd digilife-dashboard

# Clone from GitHub
git clone https://github.com/markplus-apps/digilife.git .

# Install dependencies
npm install

# Create .env.local
nano .env.local
# (paste environment variables)

# Build
npm run build

# Install PM2 (if not already)
npm install -g pm2

# Start with PM2
pm2 start npm --name "digilife-dashboard" -- start
pm2 save
pm2 startup
```

#### Configure Nginx (for custom domain)

```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/digilife-dashboard

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/digilife-dashboard /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Install SSL certificate (Let's Encrypt)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

---

## ✅ CHECKLIST

- [ ] PostgreSQL database created
- [ ] Database schema migrated
- [ ] Data migrated from Google Sheets
- [ ] Next.js project initialized
- [ ] GitHub repository connected
- [ ] Authentication working
- [ ] Test login successful
- [ ] Production deployment done
- [ ] Domain configured
- [ ] SSL certificate installed

---

## 🎯 NEXT STEPS

After basic setup is complete:

1. **Create customer management pages**
2. **Create group management UI**
3. **Create payment processing form**
4. **Build analytics dashboard**
5. **Add real-time updates**
6. **Implement role-based access control**

---

## 📞 TROUBLESHOOTING

### Issue: Cannot connect to PostgreSQL
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check if port 5432 is open
sudo netstat -tlnp | grep 5432

# Test connection
psql -U digilife_user -d digilifedb -h localhost
```

### Issue: npm install fails
```bash
# Clear cache
npm cache clean --force

# Use legacy peer deps
npm install --legacy-peer-deps
```

### Issue: Port 3000 already in use
```powershell
# Kill process on port 3000 (Windows)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process

# Or use different port
# In package.json, change start script:
# "dev": "next dev -p 3001"
```

---

**Status:** Ready to start! 🚀
**Last Updated:** 2026-02-22
