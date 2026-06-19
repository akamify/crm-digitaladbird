async function initiateLeadCall({ lead, user }) {
  return {
    provider: 'mock',
    providerCallId: `mock-${Date.now()}-${lead.id.slice(0, 8)}-${user.id.slice(0, 8)}`,
    status: 'initiated',
  };
}

async function getCallStatus(providerCallId) {
  return { providerCallId, status: 'initiated' };
}

function handleProviderWebhook(payload) {
  return payload;
}

function normalizeProviderStatus(status) {
  return status || 'initiated';
}

module.exports = {
  initiateLeadCall,
  getCallStatus,
  handleProviderWebhook,
  normalizeProviderStatus,
};
