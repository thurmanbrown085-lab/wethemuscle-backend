const fs = require('fs');
const path = require('path');

const HOST_PART = ['www', 'wethemuscleglobal', 'com'].join('.');
const ROUTE_PART = ['/api', 'ingest-terminal-payload'].join('/');

const TERMINAL_CONFIG = {
  terminalId: 'TERM-WTM-001',
  entityName: 'WE THE MUSCLE LLC',
  ein: 'XX-XXXXXXX',
  businessAddress: 'Enter Business Street Address, Flint, MI',
  contactPerson: 'Thurman Brown',
  billingInquiries: 'billing@wethemuscleglobal.com',
  softwareEndpoint: 'https://' + HOST_PART + ROUTE_PART,
  localLogFile: path.join(__dirname, 'terminal_ledger_records.json'),
  feeRates: {
    techHourlyRate: 150.00,
    managementHourlyRate: 100.00,
    administrationFlatFee: 50.00,
    transmissionFlatFee: 1.50,
    stripeCardPercent: 0.029,
    stripeCardFixed: 0.30,
    stripeAchPercent: 0.008,
    stripeAchCap: 5.00
  }
};

function calculateTransactionFees(baseAmount, { txType = 'settlement', techHours = 1, managementHours = 1, paymentRail = 'card' } = {}) {
  const numericAmount = parseFloat(baseAmount) || 0;
  const absAmount = Math.abs(numericAmount);
  const tHours = Math.max(0, parseFloat(techHours) || 0);
  const mHours = Math.max(0, parseFloat(managementHours) || 0);
  const isNegativeReconciliation = (txType === 'debit' || txType === 'reconciliation' || numericAmount < 0);

  const techFee = +(tHours * TERMINAL_CONFIG.feeRates.techHourlyRate).toFixed(2);
  const managementFee = +(mHours * TERMINAL_CONFIG.feeRates.managementHourlyRate).toFixed(2);
  const administrationFee = absAmount > 0 ? TERMINAL_CONFIG.feeRates.administrationFlatFee : 0;
  const transmissionFee = absAmount > 0 ? TERMINAL_CONFIG.feeRates.transmissionFlatFee : 0;

  let stripeProcessingFee = 0;
  let stripeRateLabel = '0%';
  if (absAmount > 0) {
    if (paymentRail === 'ach') {
      stripeProcessingFee = +Math.min(absAmount * TERMINAL_CONFIG.feeRates.stripeAchPercent, TERMINAL_CONFIG.feeRates.stripeAchCap).toFixed(2);
      stripeRateLabel = '0.8% ACH (capped at $5.00)';
    } else {
      stripeProcessingFee = +(absAmount * TERMINAL_CONFIG.feeRates.stripeCardPercent + TERMINAL_CONFIG.feeRates.stripeCardFixed).toFixed(2);
      stripeRateLabel = '2.9% + $0.30 Card';
    }
  }

  const totalFees = +(techFee + managementFee + administrationFee + transmissionFee + stripeProcessingFee).toFixed(2);
  const signedGross = isNegativeReconciliation ? -absAmount : absAmount;
  const signedNet = +(signedGross - totalFees).toFixed(2);

  return {
    grossAmount: signedGross,
    techHours: tHours,
    managementHours: mHours,
    paymentRail: paymentRail,
    fees: {
      techFee: techFee,
      managementFee: managementFee,
      administrationFee: administrationFee,
      transmissionFee: transmissionFee,
      stripeProcessingFee: stripeProcessingFee,
      stripeRateApplied: stripeRateLabel,
      totalFees: totalFees,
      memo: `Tech Fee ($${techFee.toFixed(2)} @ $150/hr x ${tHours}h), Management Fee ($${managementFee.toFixed(2)} @ $100/hr x ${mHours}h), Administration Fee ($${administrationFee.toFixed(2)}), Transmission Fee ($${transmissionFee.toFixed(2)}), Stripe Fee ($${stripeProcessingFee.toFixed(2)} [${stripeRateLabel}])`
    },
    netSettlementAmount: signedNet,
    reconciliationMode: isNegativeReconciliation ? 'NEGATIVE_RECONCILIATION' : 'STANDARD_SETTLEMENT'
  };
}

function buildAndSavePayload({ poNumber, product, projectName, amount, techHours = 1, managementHours = 1, paymentRail = 'card', txType = 'settlement', eventType = 'MANUAL_TERMINAL_TRIGGER' }) {
  const financials = calculateTransactionFees(amount, { txType, techHours, managementHours, paymentRail });

  const payload = {
    event: {
      type: eventType,
      detectedAt: new Date().toISOString(),
      terminalId: TERMINAL_CONFIG.terminalId
    },
    entityProfile: {
      company: TERMINAL_CONFIG.entityName,
      ein: TERMINAL_CONFIG.ein,
      businessAddress: TERMINAL_CONFIG.businessAddress,
      contactPerson: TERMINAL_CONFIG.contactPerson,
      billingInquiries: TERMINAL_CONFIG.billingInquiries
    },
    orderDetails: {
      poNumber: poNumber,
      productOrContent: product,
      projectName: projectName || 'PROJECT TAKEOFF'
    },
    financialBreakdown: financials
  };

  let existingRecords = [];
  if (fs.existsSync(TERMINAL_CONFIG.localLogFile)) {
    try {
      existingRecords = JSON.parse(fs.readFileSync(TERMINAL_CONFIG.localLogFile, 'utf8'));
    } catch (e) {
      existingRecords = [];
    }
  }
  existingRecords.push(payload);
  fs.writeFileSync(TERMINAL_CONFIG.localLogFile, JSON.stringify(existingRecords, null, 2));
  console.log(`Saved PO# ${poNumber} locally to ${TERMINAL_CONFIG.localLogFile}`);

  return payload;
}

async function dispatchToSoftwareSystem(payload) {
  console.log(`Dispatching payload for PO# ${payload.orderDetails.poNumber} to ${TERMINAL_CONFIG.softwareEndpoint}...`);
  try {
    const response = await fetch(TERMINAL_CONFIG.softwareEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-ID': TERMINAL_CONFIG.terminalId,
        'X-Idempotency-Key': `wtm-${payload.orderDetails.poNumber}-${Date.now()}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.ok && result.success) {
      console.log('Software System Ingestion Confirmed:', JSON.stringify(result, null, 2));
    } else {
      console.error('Software System Rejected Payload:', result);
    }
    return result;
  } catch (err) {
    console.error(`Dispatch Network Error (Queued Locally): ${err.message}`);
  }
}

async function runTerminalProcess() {
  const args = process.argv.slice(2);
  const poNumber = args[0] || `PO-${Date.now()}`;
  const product = args[1] || 'Commercial Operations Service';
  const projectName = args[2] || 'PROJECT TAKEOFF';
  const amount = parseFloat(args[3]) || 500.00;
  const techHours = args[4] !== undefined ? parseFloat(args[4]) : 1;
  const managementHours = args[5] !== undefined ? parseFloat(args[5]) : 1;
  const paymentRail = args[6] || 'card';
  const txType = args[7] || 'settlement';

  const payload = buildAndSavePayload({
    poNumber,
    product,
    projectName,
    amount,
    techHours,
    managementHours,
    paymentRail,
    txType,
    eventType: 'TERMINAL_EVENT_DETECTED'
  });

  await dispatchToSoftwareSystem(payload);
}

function watchTerminalEvents(watchFile = path.join(__dirname, 'incoming_terminal_event.json')) {
  if (!fs.existsSync(watchFile)) {
    fs.writeFileSync(watchFile, JSON.stringify({ status: 'STANDBY' }, null, 2));
  }
  console.log(`Event Detection Active — Watching ${watchFile} for incoming triggers...`);
  fs.watchFile(watchFile, { interval: 1500 }, async () => {
    try {
      const raw = fs.readFileSync(watchFile, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.poNumber && data.status === 'READY_TO_DISPATCH') {
        console.log(`Event Detected for PO# ${data.poNumber}!`);
        const payload = buildAndSavePayload({ ...data, eventType: 'AUTO_FILE_EVENT_DETECTED' });
        await dispatchToSoftwareSystem(payload);
        fs.writeFileSync(watchFile, JSON.stringify({ ...data, status: 'DISPATCHED' }, null, 2));
      }
    } catch (e) {}
  });
}

if (require.main === module) {
  if (process.argv.includes('--watch')) {
    watchTerminalEvents();
  } else {
    runTerminalProcess();
  }
}

module.exports = { calculateTransactionFees, buildAndSavePayload, dispatchToSoftwareSystem };
