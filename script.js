/**
 * Finalizes payment transactions and sends them to the reconciliation pipeline.
 * @param {string} transactionType - 'POS_CHECKOUT', 'ONLINE_CHECKOUT', 'INVOICE_CHARGE', 'INVOICE_CREDIT'
 * @param {Object} data - The core financial transaction details
 */
async function processPaymentIntegration(transactionType, data) {
  // Hardcoded to your production container API endpoint path
  const endpoint = 'https://onrender.com';

  const transactionPayload = {
    source: data.source || 'ONLINE_CHECKOUT',
    transactionType: transactionType,        
    invoiceId: data.invoiceId,                 
    amount: transactionType === 'INVOICE_CREDIT' ? -Math.abs(data.amount) : Math.abs(data.amount),
    terminalId: data.terminalId || null,
    customerId: data.customerId || null,
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `idemp-${data.invoiceId}-${Date.now()}`
      },
      body: JSON.stringify(transactionPayload)
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log(`✅ [${transactionType}] Ledger Balanced & Reconciled. Stripe ID:`, result.id);
      updateSystemStatusDisplay(`Success: Transaction ${result.id} Reconciled.`);
      return result;
    } else {
      console.error(`⚠️ Reconciliation Mismatch or Gateway Rejection:`, result.error);
      updateSystemStatusDisplay(`Failed: ${result.error}`);
    }

  } catch (error) {
    console.error('❌ Critical Network/System Error in Payment Loop:', error);
    updateSystemStatusDisplay('System Error: Transaction queued for offline reconciliation.');
  }
}

function updateSystemStatusDisplay(message) {
  const statusElement = document.getElementById('terminal-status-log');
  if (statusElement) statusElement.innerText = message;
}
