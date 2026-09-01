const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.join(__dirname, 'audit_trail.log');
const VALID_MUTATIONS = ['INSERT', 'UPDATE', 'DELETE'];

function processAndAuditPayload({ 
  user, 
  action, 
  resource, 
  status, 
  incomingJsonPayload, 
  request,
  gatewayHandshake 
}) {
  
  // PART 1: COMPLIANCE LOGIC
  const upperAction = String(action).toUpperCase();
  if (!VALID_MUTATIONS.includes(upperAction)) {
    throw new Error(`[STRUCTURED MISMATCH]: Action '${action}' is non-compliant. Must be INSERT, UPDATE, or DELETE.`);
  }

  const networkTxId = gatewayHandshake?.gateway_handshake?.network_transaction_id 
    || gatewayHandshake?.network_transaction_id;

  if (!networkTxId) {
    throw new Error('[STRUCTURED MISMATCH]: Missing mandatory corporate tracking identifier: gateway_handshake.network_transaction_id');
  }

  const auditPayload = {
    id: `audit_${crypto.randomUUID()}`,
    timestamp: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),

    compliance_version: "2.2.0",
    actor: {
      id: user?.id || "unified_gateway_process",
      role: user?.role || "system_service",
      ipAddress: request?.ip || "127.0.0.1",
      userAgent: request?.headers?.['user-agent'] || "secure_internal_pipeline"
    },
    event: {
      action: upperAction, 
      status: status || "PROCESSED",
      network_transaction_id: networkTxId,
      description: `Unified ingest recording for action: ${upperAction}`
    },
    resource: {
      type: resource?.type || "unified_ledger_resource",
      id: resource?.id || "unassigned_id"
    },
    details: {
      transmissionChannel: "unified_data_gateway",
      payload: typeof incomingJsonPayload === 'object' ? JSON.stringify(incomingJsonPayload) : (incomingJsonPayload || "{}")
    }
  };

  // Commit to append-only file and stream copy out simultaneously (Log Shipping)
  try {
    const logLine = JSON.stringify(auditPayload) + '\n';
    fs.writeFileSync(LOG_FILE_PATH, logLine, { flag: 'a', encoding: 'utf8' });
    console.log(`[SHIPPED_COMPLIANCE_STREAM]: ${logLine.trim()}`);
  } catch (error) {
    console.error('CRITICAL COMPLIANCE FAILURE: Failed to lock audit entry:', error.message);
    throw error; 
  }

  // PART 2: REGULAR DATA LOGIC
  const cleanRegularData = typeof incomingJsonPayload === 'string' 
    ? JSON.parse(incomingJsonPayload) 
    : incomingJsonPayload;

  return {
    auditRecordId: auditPayload.id,
    networkTransactionId: networkTxId,
    timestamp: auditPayload.timestamp,
    regularDataFeed: cleanRegularData
  };
}

module.exports = { processAndAuditPayload };
