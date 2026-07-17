const config = require('../../config/env');

function addSessionHours(date) {
  const base = date ? new Date(date) : new Date();
  return new Date(base.getTime() + config.wasp.chatSessionHours * 60 * 60 * 1000);
}

function getChatSessionState(conversation) {
  if (!conversation || conversation.channel !== 'whatsapp') {
    return { status: 'internal', can_send_whatsapp: false, expires_at: null, disabled_reason: null };
  }
  const providerMetadata = conversation.provider_metadata || {};
  const providerCanReply = providerMetadata.can_reply;
  const providerWindowStatus = String(providerMetadata.service_window_status || conversation.session_status || '').toLowerCase();
  const providerClosed = providerCanReply === false || providerWindowStatus === 'closed';
  const providerOpen = providerCanReply === true || providerWindowStatus === 'open';
  const expiresAt = conversation.session_expires_at || null;
  const windowOpen = Boolean(expiresAt && new Date(expiresAt) > new Date());

  if (providerClosed) {
    return {
      status: 'expired',
      can_send_whatsapp: false,
      expires_at: expiresAt,
      disabled_reason: '24-hour WhatsApp service window is closed. Ask the customer to send Hi before replying.',
    };
  }
  if (conversation.is_external_unknown) {
    const open = providerOpen && windowOpen;
    return {
      status: open ? 'admin_only_external' : 'expired',
      can_send_whatsapp: open,
      expires_at: expiresAt,
      disabled_reason: open ? 'Admin-only external chat' : '24-hour WhatsApp service window is closed. Ask the customer to send Hi before replying.',
    };
  }
  if (!conversation.last_inbound_at) {
    return {
      status: 'waiting_for_customer',
      can_send_whatsapp: false,
      expires_at: null,
      disabled_reason: 'Waiting for customer message. WhatsApp reply is available only after the customer sends a message.',
    };
  }
  if (!conversation.session_expires_at || new Date(conversation.session_expires_at) <= new Date()) {
    return {
      status: 'expired',
      can_send_whatsapp: false,
      expires_at: conversation.session_expires_at || null,
      disabled_reason: '24-hour WhatsApp service window is closed. Ask the customer to send Hi before replying.',
    };
  }
  return {
    status: 'open',
    can_send_whatsapp: true,
    expires_at: conversation.session_expires_at,
    disabled_reason: null,
  };
}

module.exports = {
  addSessionHours,
  getChatSessionState,
};
