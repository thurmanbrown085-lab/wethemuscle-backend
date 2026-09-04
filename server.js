require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const app = express();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static(__dirname));
app.use(express.json());

// Transmission Type Detector
function detectTransmissionType(inputString) {
  const cleanInput = inputString.replace(/[\s-]/g, '');
  const debitCardRegex = /^\d{13,16}$/;
  const routingNumberRegex = /^\d{9}$/;
  const bankAccountRegex = /^\d{4,17}$/;

  if (debitCardRegex.test(cleanInput)) return { type: 'debit_card', value: cleanInput };
  if (routingNumberRegex.test(cleanInput)) return { type: 'routing_number', value: cleanInput };
  if (bankAccountRegex.test(cleanInput)) return { type: 'account_number', value: cleanInput };
  return { type: 'unknown', value: cleanInput };
}

// Master Production Route for POS, Online, and Credits
app.post('/api/stripe-reconcile', async (req, res) => {
  const { transactionType, amount, invoiceId, terminalId, customerId } = req.body;

  try {
    let stripeAction;
    const reconciliationMetadata = {
      internal_invoice_id: invoiceId,
      settlement_channel: transactionType,
      terminal_hardware_id: terminalId || 'N/A',
      auto_reconcile: 'true'
    };

    switch (transactionType) {
      case 'POS_CHECKOUT':
        stripeAction = await stripe.terminal.readers.processPaymentIntent(terminalId, {
          payment_intent: await stripe.paymentIntents.create({
            amount, currency: 'usd', payment_method_types: ['card_present'],
            metadata: reconciliationMetadata
          })
        });
        break;

      case 'ONLINE_CHECKOUT':
      case 'INVOICE_CHARGE':
        stripeAction = await stripe.paymentIntents.create({
          amount, currency: 'usd',
          customer: customerId,
          metadata: reconciliationMetadata,
          capture_method: 'automatic'
        });
        break;

      case 'INVOICE_CREDIT':
        stripeAction = await stripe.refunds.create({
          amount: Math.abs(amount),
          metadata: reconciliationMetadata
        });
        break;

      default:
        return res.status(400).json({ success: false, error: 'Invalid channel configuration' });
    }

    return res.status(200).json({ success: true, id: stripeAction.id });

  } catch (stripeError) {
    return res.status(500).json({ success: false, error: stripeError.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Secure server running on port ${port}`));
