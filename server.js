const fs = require("fs");
const express = require('express');
const path = require('path');
const app = express();

app.use((req, res, next) => req.originalUrl === '/webhook' ? next() : express.json()(req, res, next));

// ==========================================
// INTEGRATED STRIPE SETTLEMENT ROUTE
// ==========================================
app.post('/api/create-settlement-intent', async (req, res) => {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const { amount, invoiceId, tx_type } = req.body;

        let rawAmount = parseFloat(amount) || 0;
        const transactionType = tx_type || "settlement";

        if (transactionType === "debit" || transactionType === "reconciliation") {
            console.log(`[RECONCILIATION] Aligning negative transaction outbound entry for Invoice: ${invoiceId}`);
        }

        const chargeCents = Math.round(Math.abs(rawAmount) * 100);

        if (chargeCents === 0) {
            return res.status(400).json({ success: false, error: "Invalid settlement threshold amount." });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: chargeCents,
            currency: 'usd',
            payment_method_types: ['us_bank_account'],
            payment_method_options: {
                us_bank_account: {
                    financial_connections: {
                        permissions: ['payment_method', 'balances', 'ownership', 'transactions'],
                    },
                },
            },
            metadata: {
                invoice_id: invoiceId,
                reconciliation_type: transactionType,
                company: 'WE THE MUSCLE LLC'
            },
            description: `Settlement Gateway Process - Invoice Ref: ${invoiceId}`
        });

        res.status(200).json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            transactionId: paymentIntent.id
        });
    } catch (error) {
        console.error(`[SETTLEMENT ROUTE FAILED] ${error.message}`);
        res.status(500).json({ success: false, error: 'Internal Server Settlement Error' });
    }
});

// ==========================================
// ASYNCHRONOUS WEBHOOK SIGNATURE VERIFIER
// ==========================================
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`❌ Webhook Signature Verification Failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        console.log(`✅ [LEDGER UPDATED] Settlement for Invoice ${paymentIntent.metadata.invoice_id} successfully processed!`);
    }

    res.status(200).json({ received: true });
});

// Serves the front-end visual management dashboard interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Automated Smartlink payload serialization and URL query parameter routing path
app.get('/api/transmissions/smartlink', (req, res) => {
    try {
        const { item_id, qty, amount, routing_matrix, transmission_id, tx_type } = req.query;

        if (!routing_matrix) {
            return res.status(400).json({
                status: "Rejected",
                message: "Missing required routing_matrix code parameter."
            });
        }

        let calculatedAmount = parseInt(amount) || 0;
        const transactionType = tx_type || "settlement";

        if (transactionType === "debit" || transactionType === "reconciliation") {
            calculatedAmount = -Math.abs(calculatedAmount);
        }

        console.log(`[SMARTLINK PAYLOAD RECEIVED] Type: ${transactionType}, Amount: ${calculatedAmount}, Routing Matrix: ${routing_matrix}`);

        const normalizedPayload = {
            pipelineType: req.query.pipelineType || "Software",
            transmission_id: transmission_id || `TLK-${Date.now()}`,
            routing_matrix: routing_matrix,
            amount: calculatedAmount,
            transactionType: transactionType,
            data: { item_id, qty }
        };

        res.status(200).json({
            status: "Processed",
            message: "Payload successfully serialized and processed.",
            transaction: normalizedPayload
        });
    } catch (error) {
        console.error(`[SMARTLINK REJECTED] ${error.message}`);
        res.status(400).json({ status: "Rejected", message: error.message });
    }
});

// Stripe Compliance Verification Endpoint
app.get('/privacy', (req, res) => {
  res.send(`
    <html>
      <head><title>Privacy Policy - WE THE MUSCLE LLC</title></head>
      <body style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
        <h1>Privacy Policy - WE THE MUSCLE LLC</h1>
        <p><strong>Last Updated: October 2026</strong></p>
        <p>WE THE MUSCLE LLC ("we," "us," or "our") is committed to protecting your privacy. This policy outlines how we handle financial data collected via Stripe Financial Connections.</p>
        <h3>1. Data Collection & Use</h3>
        <ul>
          <li><strong>Tokenized Account/Routing Numbers:</strong> Used to safely establish valid payment channels and execute automated direct settlements.</li>
          <li><strong>Account Balance Data:</strong> Monitored prior to fund transfers to verify sufficient funding and avoid account overdraft loops.</li>
          <li><strong>Transaction Histories:</strong> Processed to auto-reconcile business invoices and maintain internal financial ledgers.</li>
          <li><strong>Account Ownership Details:</strong> Used to cross-verify identities against banking records for regulatory compliance.</li>
        </ul>
        <h3>2. Data Safeguards</h3>
        <ul>
          <li><strong>Location:</strong> All data is stored and processed exclusively within secure networks inside the United States.</li>
          <li><strong>Sharing:</strong> We do not sell, trade, or share your financial records with any third-party marketing networks or analytics entities.</li>
        </ul>
        <h3>3. Disconnection Rights</h3>
        <p>You may disconnect your bank account or request full data deletion at any time by contacting our administrative desk at thurmanbrown085@gmail.com.</p>
      </body>
    </html>
  `);
});

// Live Stripe Balance Verification Route Handler
app.get('/check-stripe-balance', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const balance = await stripe.balance.retrieve();
    res.json({ success: true, business: "WE THE MUSCLE LLC", data: balance });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Live $1.00 Production Test Charge Endpoint
app.get('/run-live-test-charge', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100, 
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      payment_method_options: {
        us_bank_account: {
          financial_connections: {
            permissions: ['payment_method', 'balances', 'ownership', 'transactions'],
          },
        },
      },
      description: 'Approved Financial Connections Bank Integration - WE THE MUSCLE LLC',
    });

    res.json({
      success: true,
      message: "Approved Bank Checkout Initialized!",
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force Render Public Traffic Binding
const PORT_LISTENER = process.env.PORT || 10000;


const LEDGER_FILE = require("path").join(__dirname, "cloud_ledger.json");
function verifyApiKey(req, res) {
  const expected = process.env["WTM_API_KEY"];
  if (!expected) return true;
  const provided = req.headers["x-api-key"] || req.query.key;
  if (provided !== expected) {
    res.status(401).json({ success: false, error: "Unauthorized: Invalid WTM_API_KEY." });
    return false;
  }
  return true;
}
function saveToCloudLedger(entry) {
  let list = [];
  if (fs.existsSync(LEDGER_FILE)) { try { list = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")); } catch (e) {} }
  list.unshift(entry);
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(list, null, 2));
}
app.get("/api/ledger", (req, res) => {
  if (!verifyApiKey(req, res)) return;
  let list = [];
  if (fs.existsSync(LEDGER_FILE)) { try { list = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")); } catch (e) {} }
  res.json({ success: true, count: list.length, records: list });
});
app.get("/api/export-csv", (req, res) => {
  if (!verifyApiKey(req, res)) return;
  let list = [];
  if (fs.existsSync(LEDGER_FILE)) { try { list = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")); } catch (e) {} }
  const rows = ["Timestamp,Category,Reference,PO_Number,Project_Or_Debtor,Terms,Gross_Or_Face_Value,Total_Fees,Net_Capital_Realized"];
  list.forEach(r => {
    rows.push([r.ingestedAt, r.category, r.reference, r.poNumber, "\"" + (r.party || "") + "\"", "\"" + (r.terms || "") + "\"", r.grossAmount, r.totalFees, r.netCapital].join(","));
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=WTM_Ledger_Export.csv");
  res.send(rows.join("\n"));
});

app.post("/api/ingest-terminal-payload", async (req, res) => {
  if (!verifyApiKey(req, res)) return;
  try {
    const incoming = req.body;
    if (!incoming || !incoming.orderDetails || !incoming.financialBreakdown) {
      return res.status(400).json({ success: false, error: "Invalid terminal payload structure." });
    }
    const { orderDetails, entityProfile, financialBreakdown, event } = incoming;
    const absGross = Math.abs(parseFloat(financialBreakdown.grossAmount) || 0);
    const tHours = financialBreakdown.techHours !== undefined ? Math.max(0, parseFloat(financialBreakdown.techHours) || 0) : 1;
    const mHours = financialBreakdown.managementHours !== undefined ? Math.max(0, parseFloat(financialBreakdown.managementHours) || 0) : 1;
    const rail = financialBreakdown.paymentRail === "ach" ? "ach" : "card";
    const termsDays = new Array(0, 15, 30, 60).includes(Number(financialBreakdown.netTermsDays)) ? Number(financialBreakdown.netTermsDays) : 0;
    const termsLabel = termsDays === 0 ? "Same Day (Net 0)" : "Net " + termsDays;
    const settlementDueDate = new Date(Date.now() + termsDays * 86400000).toISOString().split("T").shift();

    const verifiedTechFee = +(tHours * 150.00).toFixed(2);
    const verifiedMgmtFee = +(mHours * 100.00).toFixed(2);
    const verifiedAdminFee = absGross > 0 ? 50.00 : 0;
    const verifiedTransFee = absGross > 0 ? 1.50 : 0;
    const verifiedStripeFee = absGross > 0
      ? (rail === "ach" ? +Math.min(absGross * 0.008, 5.00).toFixed(2) : +(absGross * 0.029 + 0.30).toFixed(2))
      : 0;

    const verifiedTotalFees = +(verifiedTechFee + verifiedMgmtFee + verifiedAdminFee + verifiedTransFee + verifiedStripeFee).toFixed(2);
    const isNegative = financialBreakdown.reconciliationMode === "NEGATIVE_RECONCILIATION" || String(financialBreakdown.grossAmount).startsWith("-");
    const verifiedNet = +((isNegative ? -absGross : absGross) - verifiedTotalFees).toFixed(2);
    const verifiedMemo = "Terms: " + termsLabel + " (Due " + settlementDueDate + ") | Tech: $" + verifiedTechFee.toFixed(2) + " (" + tHours + "h) | Mgmt: $" + verifiedMgmtFee.toFixed(2) + " (" + mHours + "h) | Admin: $" + verifiedAdminFee.toFixed(2) + " | Trans: $" + verifiedTransFee.toFixed(2) + " | Stripe: $" + verifiedStripeFee.toFixed(2);
    saveToCloudLedger({ ingestedAt: new Date().toISOString(), category: "PO_SETTLEMENT", reference: orderDetails.poNumber, poNumber: orderDetails.poNumber, party: orderDetails.projectName, terms: termsLabel, grossAmount: isNegative ? -absGross : absGross, totalFees: verifiedTotalFees, netCapital: verifiedNet });
    console.log("[INGESTION] PO#: " + orderDetails.poNumber + " | Project: " + orderDetails.projectName + " | Net: $" + verifiedNet + " | " + verifiedMemo);
    res.status(200).json({ success: true, ingestedAt: new Date().toISOString(), terminalId: event?.terminalId || "UNKNOWN", poNumber: orderDetails.poNumber, projectName: orderDetails.projectName, entity: entityProfile?.company || "WE THE MUSCLE LLC", verifiedFinancials: { grossAmount: isNegative ? -absGross : absGross, techHours: tHours, managementHours: mHours, paymentRail: rail, netTermsDays: termsDays, netTermsLabel: termsLabel, settlementDueDate: settlementDueDate, techFee: verifiedTechFee, managementFee: verifiedMgmtFee, administrationFee: verifiedAdminFee, transmissionFee: verifiedTransFee, stripeProcessingFee: verifiedStripeFee, totalFees: verifiedTotalFees, netSettlementAmount: verifiedNet, feeMemo: verifiedMemo } });
  } catch (err) { res.status(500).json({ success: false, error: "Ingestion failed." }); }
});

app.post("/api/ingest-factoring-payload", async (req, res) => {
  if (!verifyApiKey(req, res)) return;
  try {
    const inc = req.body;
    if (!inc || !inc.factoringDetails || !inc.factoringBreakdown) {
      return res.status(400).json({ success: false, error: "Invalid factoring payload structure." });
    }
    const { factoringDetails, entityProfile, factoringBreakdown, event } = inc;
    const faceValue = Math.abs(parseFloat(factoringBreakdown.invoiceFaceValue) || 0);
    const advPct = Math.min(100, Math.max(1, parseFloat(factoringBreakdown.advancePercent) || 80));
    const resPct = +(100 - advPct).toFixed(2);
    const termsDays = new Array(0, 15, 30, 60).includes(Number(factoringBreakdown.netTermsDays)) ? Number(factoringBreakdown.netTermsDays) : 30;
    const termsLabel = termsDays === 0 ? "Same Day (Net 0)" : "Net " + termsDays;
    const maturityDate = new Date(Date.now() + termsDays * 86400000).toISOString().split("T").shift();
    const rateMap = { 0: 0.01, 15: 0.015, 30: 0.025, 60: 0.04 };
    const discountRate = rateMap[termsDays] || 0.025;
    const grossAdvance = +(faceValue * (advPct / 100)).toFixed(2);
    const reserveHoldback = +(faceValue - grossAdvance).toFixed(2);
    const factoringDiscountFee = +(faceValue * discountRate).toFixed(2);
    const upfrontOps = parseFloat(factoringBreakdown.fees?.upfrontOperationalFees) || 0;
    const netAdvanceToday = +(grossAdvance - upfrontOps).toFixed(2);
    const netReserveAtMaturity = +(reserveHoldback - factoringDiscountFee).toFixed(2);
    const netCap = +(netAdvanceToday + netReserveAtMaturity).toFixed(2);
    saveToCloudLedger({ ingestedAt: new Date().toISOString(), category: "INVOICE_FACTORING", reference: factoringDetails.invoiceNumber, poNumber: factoringDetails.poNumber, party: factoringDetails.accountDebtor, terms: termsLabel, grossAmount: faceValue, totalFees: +(upfrontOps + factoringDiscountFee).toFixed(2), netCapital: netCap });
    res.status(200).json({
      success: true,
      ingestedAt: new Date().toISOString(),
      terminalId: event?.terminalId || "UNKNOWN",
      invoiceNumber: factoringDetails.invoiceNumber,
      poNumber: factoringDetails.poNumber,
      accountDebtor: factoringDetails.accountDebtor,
      entity: entityProfile?.company || "WE THE MUSCLE LLC",
      verifiedFactoringSchedule: {
        invoiceFaceValue: faceValue,
        advancePercent: advPct,
        reservePercent: resPct,
        netTermsLabel: termsLabel,
        maturityDate: maturityDate,
        grossAdvanceAmount: grossAdvance,
        reserveHoldbackAmount: reserveHoldback,
        factoringDiscountFee: factoringDiscountFee,
        upfrontOperationalFees: upfrontOps,
        netAdvanceDisbursedToday: netAdvanceToday,
        netReserveReleaseAtMaturity: netReserveAtMaturity,
        totalNetCapitalRealized: +(netAdvanceToday + netReserveAtMaturity).toFixed(2)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Factoring ingestion failed." });
  }
});


app.post('/api/admin/cleanup-tests', async (req, res) => {
  const sec = process.env.COUPA_WEBHOOK_SECRET;
var incoming = req.headers['x-webhook-secret'];
  if (sec && incoming !== sec) return res.status(401).json({ status: 'Unauthorized' });
  try {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const r = await c.query("DELETE FROM oltp_transmissions WHERE idempotency_key LIKE 'wtm-order-%' OR idempotency_key LIKE 'wtm-tps-test-%' OR idempotency_key LIKE 'wtm-lim-%'");
    await c.end();
    return res.json({ status: 'Cleaned', deletedRows: r.rowCount });
  } catch (e) {
    return res.status(500).json({ status: 'Error', message: e.message });
  }
});
app.listen(PORT_LISTENER, () => { console.log("WE THE MUSCLE LLC Active on Port " + PORT_LISTENER); });
