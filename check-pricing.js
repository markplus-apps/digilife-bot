// Quick script to check pricing data
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'digilifedb',
  user: 'digilife_user',
  password: 'MasyaAllah26',
});

async function checkPricing() {
  try {
    const result = await pool.query(`
      SELECT product, duration, price, description 
      FROM pricing 
      WHERE is_active = true 
      ORDER BY product, duration
    `);
    
    console.log('\n📊 PRICING DATA FROM DATABASE:\n');
    result.rows.forEach(row => {
      const priceNormal = row.description ? row.description.match(/Harga normal:\s*(\d+)/) : null;
      const normalPrice = priceNormal ? parseInt(priceNormal[1]) : null;
      
      console.log(`${row.product} - ${row.duration}:`);
      if (normalPrice && normalPrice > row.price) {
        console.log(`  Normal: Rp ${normalPrice.toLocaleString('id-ID')}`);
        console.log(`  Promo:  Rp ${parseInt(row.price).toLocaleString('id-ID')}`);
      } else {
        console.log(`  Price:  Rp ${parseInt(row.price).toLocaleString('id-ID')}`);
      }
      console.log('');
    });
    
    pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    pool.end();
  }
}

checkPricing();
