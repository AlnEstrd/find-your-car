// Channel registry. A channel adapter is a plain object:
//
//   {
//     name:   'whatsapp',
//     routes: { 'POST /api/whatsapp/webhook': handler },  // inbound webhooks (optional)
//     start() {}                                          // pollers / outbound listeners (optional)
//   }
//
// Inbound:  call assistant.handleIncoming({ channel, externalId, name, text })
// Outbound: listen to store.bus 'message' events for conversations on your channel
//           and deliver messages whose role is 'bot' or 'agent'.
//
// That's the whole contract. To add WhatsApp (Meta Cloud API / Twilio) or
// Messenger, copy telegram.js, swap the two HTTP calls, and register it below.

module.exports = [require('./web'), require('./telegram')];
