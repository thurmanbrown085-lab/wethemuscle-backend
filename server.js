const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

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

        // Adjust ledger calculation balance format based on negative push/debit reconciliation rules
        let calculatedAmount = parseInt(amount) || 0;
        const transactionType = tx_type || "settlement"; // Defaults to settlement structure

        if (transactionType === "debit" || transactionType === "reconciliation") {
            // Forces negative transaction entry value to record outbound settlement push alignment
            calculatedAmount = -Math.abs(calculatedAmount);
        }

        console.log(`[SMARTLINK PAYLOAD RECEIVED] Type: ${transactionType}, Amount: ${calculatedAmount}, Routing Matrix: ${routing_matrix}`);

        // Format data into standard transaction structure
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

app.listen(process.env.PORT || 10000, () => console.log('WTM Gateway API listening on port process.env.PORT || 10000'));

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

// Force Render Public Traffic Binding
const PORT_LISTENER = process.env.PORT || 10000;
app.listen(PORT_LISTENER, () => {
  console.log(`WE THE MUSCLE LLC Infrastructure Active on Port ${PORT_LISTENER}`);
});
