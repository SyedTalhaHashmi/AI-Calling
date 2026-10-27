const https = require("https");

/**
 * Shared HTTPS agent for live-data lookups. Node's default agent drops idle sockets after 5 s,
 * so lookups a few seconds apart paid a new TLS handshake (~0.4–0.5 s) each time.
 */
const keepAliveAgent = new https.Agent({ keepAlive: true, timeout: 60 * 1000, maxSockets: 50 });

module.exports = { keepAliveAgent };
