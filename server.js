
structEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`⚠️ Webhook transmission validation failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Detect settlement changes to dispatch automated company alerts
  if (event.type === 'credit_note.created' || event.type === 'customer.balance_transaction.created') {
    const dataObject = event.data.object;
    
    try {
      await mailTransporter.sendMail({
        from: process.env.OUTLOOK_EMAIL,
        to: process.env.OUTLOOK_EMAIL, // Dispatches a secure update to your business dashboard
        subject: `WE THE MUSCLE LLC - Ledger Synchronization Logged`,
        text: `Settlement action entry ${dataObject.id} has successfully passed external system verification.`
      });
      console.log(`Telemetry correspondence completed for token: ${dataObject.id}`);
    } catch (mailError) {
      console.error(`External mail system communication failure: ${mailError.message}`);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Unified system tracking engine live on port ${PORT}`));

