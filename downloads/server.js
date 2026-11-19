const express = require('express');
const crypto = require('crypto');
const { runCoupaSync } = require('./coupaSync');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.text({ type: ['application/xml', 'text/xml'] }));

app.get('/', (req, res) => {
  res.send('WTM Backend Gateway is Active and Secure.');
});

app.get('/api/transmissions/smartlink', (req, res) => {
  try {
    const { item_id, qty, amount, routing_matrix, transmission_id, tx_type } = req.query;
    if (!routing_matrix) {
      return res.status(400).json({ status: 'Rejected', message: 'Missing routing_matrix' });
    }
    let calculatedAmount = parseInt(amount, 10) || 0;
    if (tx_type === 'debit') calculatedAmount = -Math.abs(calculatedAmount);

    res.status(200).json({
      status: 'Processed',
      transaction: { item_id, qty, amount: calculatedAmount, routing_matrix }
    });
  } catch (error) {
    res.status(400).json({ status: 'Rejected', message: error.message });
  }
});

// Coupa Webhook & cXML Listener
app.post('/api/webhooks/coupa', (req, res) => {
  const secret = process.env.COUPA_WEBHOOK_SECRET;
  const incomingSig = req.headers['x-coupa-signature'] || req.headers['x-webhook-secret'];

  if (secret && incomingSig !== secret) {
    return res.status(401).json({ status: 'Unauthorized', message: 'Invalid webhook secret' });
  }

  console.log(`[${new Date().toISOString()}] Coupa Webhook Received:`, typeof req.body === 'string' ? 'XML Payload' : req.body);
  res.status(200).json({ status: 'Received', timestamp: new Date().toISOString() });
});

// Protected Manual / External CRON Trigger Endpoint
app.post('/api/cron/coupa-sync', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ status: 'Unauthorized' });
  }
  try {
    const result = await runCoupaSync();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ status: 'Error', message: err.message });
  }
});

// Built-in 15-minute scheduler (runs automatically while service is active)
setInterval(() => {
  runCoupaSync().catch(err => console.error('Scheduled Coupa Sync Error:', err.message));
}, 15 * 60 * 1000);

app.listen(PORT, () => console.log(`WTM Gateway API listening on port ${PORT}`));
