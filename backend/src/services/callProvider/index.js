const { AppError } = require('../../utils/errors');

function disabledProvider() {
  return {
    async initiateLeadCall() {
      return { provider: 'disabled', providerCallId: null, status: 'initiated' };
    },
    async getCallStatus(providerCallId) {
      return { providerCallId, status: 'initiated' };
    },
    handleProviderWebhook(payload) {
      return payload;
    },
    normalizeProviderStatus(status) {
      return status || 'initiated';
    },
  };
}

function unsupportedProvider(name) {
  return {
    async initiateLeadCall() {
      throw new AppError(501, 'CALL_PROVIDER_NOT_IMPLEMENTED', `${name} call provider is not implemented yet`);
    },
    async getCallStatus(providerCallId) {
      return { providerCallId, status: 'initiated' };
    },
    handleProviderWebhook(payload) {
      return payload;
    },
    normalizeProviderStatus(status) {
      return status || 'initiated';
    },
  };
}

function getCallProvider() {
  const mode = String(process.env.CALL_PROVIDER || 'disabled').toLowerCase();
  if (mode === 'mock') return require('./mockProvider');
  if (mode === 'disabled') return disabledProvider();
  return unsupportedProvider(mode);
}

function getCallProviderMode() {
  return String(process.env.CALL_PROVIDER || 'disabled').toLowerCase();
}

module.exports = {
  getCallProvider,
  getCallProviderMode,
};
