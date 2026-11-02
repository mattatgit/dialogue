// Keep the public Host header consistent with account origin checks. Previews
// still go directly to the upstream server via DIALOGUE_PREVIEW_PORT.
module.exports = {
  proxy: {
    target: 'http://127.0.0.1:4173',
    proxyReq: [(proxyReq) => proxyReq.setHeader('Host', new URL(process.env.DIALOGUE_ORIGIN).host)]
  }
};
