const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

// Force Node to serve your visual HTML assets automatically
app.use(express.static(__dirname));

// Initialize secure connection pool using Render's environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for secure Neon connections
});

// Helper utility to clean numeric strings into safe database decimals
const cleanAmount = (val) => parseFloat(String(val || 0).replace(/[^0-9.-]/g, ''));

// Catch-all route to explicitly serve index.html when hitting the home directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// PRODUCTION ROUTE: Catches and resolves raw library JSON payloads
app.post('/api/save-secure-data', async (req, res) => {
  const client = await pool.connect();
  try {
    const { secureData } = req.body;
    if (!secureData) {
      return res.status(400).json({ success: false, error: "Empty payload rejected" });
    }

    // Begin an atomic database transaction
    await client.query('BEGIN');

    // 1. Raw Archive: Write the raw file safely to your backend_2_logs JSONB column
    const logResult = await client.query(
      `INSERT INTO backend_2_logs (data_payload) VALUES ($1) RETURNING id`,
      [typeof secureData === 'string' ? JSON.parse(secureData) : secureData]
    );
    const logId = logResult.rows[0].id;
    console.log(`[Production] Raw JSON archived into backend_2_logs ID: ${logId}`);

    // Parse the object data mapping fields out dynamically
    const payload = typeof secureData === 'string' ? JSON.parse(secureData) : secureData;

    // --- FINANCIAL MAP ENGINE ---
    const invoiceNum = payload.invoice_number || `INV-${Date.now()}`;
    const customerId = payload.customer_id || 'UNKNOWN_CUST';
    const transactionAmount = cleanAmount(payload.amount);
    
    // Determine the invoice type enum state based on structural mathematical sign
    const chargeType = transactionAmount >= 0 ? 'positive' : 'negative';
    const transmissionId = payload.transmission_id || `TRM-${Date.now()}`;

    // 2. Insert into INVOICES matrix
    await client.query(
      `INSERT INTO invoices (invoice_number, customer_id, amount, type) 
       VALUES ($1, $2, $3, $4) ON CONFLICT (invoice_number) DO NOTHING`,
      [invoiceNum, customerId, Math.abs(transactionAmount), chargeType]
    );

    // 3. Insert data into TRANSACTION_METHODS setup
    await client.query(
      `INSERT INTO transaction_methods (transmission_id, method_type, masked_account_identifier)
       VALUES ($1, $2, $3) ON CONFLICT (transmission_id) DO NOTHING`,
      [transmissionId, payload.method_type || 'system_ledger', payload.masked_account || 'XXXX-SYSTEM']
    );

    // 4. Calculate accounting fee deductions and clear net metrics
    const gross = Math.abs(transactionAmount);
    const fee = cleanAmount(payload.fee_deduction || 0);
    const net = gross - fee;

    // Insert into RECONCILIATION_LEDGER matrix
    const recResult = await client.query(
      `INSERT INTO reconciliation_ledger (transmission_id, invoice_number, gross_amount, fee_deduction, net_settlement, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [transmissionId, invoiceNum, gross, fee, net, 'unreconciled']
    );
    const reconciliationId = recResult.rows[0].id;

    // 5. Build settlement clearing profile pipeline
    await client.query(
      `INSERT INTO invoice_settlement_ledger (reconciliation_id, tax_compliance_logged, cleared_at)
       VALUES ($1, $2, NOW())`,
      [reconciliationId, chargeType === 'positive'] 
    );

    // Commit all tables atomically
    await client.query('COMMIT');
    console.log(`[Production] Settlement matrix successfully balanced and closed.`);

    res.status(200).json({ 
      success: true, 
      message: "Live integration parsed, ledger reconciled, and settlement logged safely!",
      log_reference: logId
    });

  } catch (error) {
    await client.query('ROLLBACK'); // Cancel changes if any constraint crashes
    console.error("[Fatal Production Error]", error.message);
    res.status(500).json({ success: false, error: "Transaction processing failed, changes safely rolled back." });
  } finally {
    client.release();
  }
});

// Basic service status ping check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: "healthy", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server live on processing cluster channel port ${PORT}`));
