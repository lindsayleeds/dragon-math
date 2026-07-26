// Which network interface the API binds to.
//
// nginx is the only legitimate client of this process — it terminates TLS and
// proxies to 127.0.0.1:4070 (docs/NGINX.md). Binding the wildcard address
// instead would put the plaintext API on every interface, so the box's network
// ACL would be the only thing standing between the internet and a TLS-bypassing
// request. Loopback is therefore the default, and opting out has to be
// deliberate: set API_HOST (e.g. API_HOST=0.0.0.0 inside a container where the
// proxy lives in a different network namespace).
//
// A fixed default is also what makes pm2 cluster mode work: every worker calls
// listen() with the same host+port, which is the key Node's cluster master uses
// to hand out the one shared bound handle.

const LOOPBACK_HOST = '127.0.0.1';

function resolveBindHost(env = process.env) {
  const configured = typeof env.API_HOST === 'string' ? env.API_HOST.trim() : '';
  return configured || LOOPBACK_HOST;
}

module.exports = { resolveBindHost, LOOPBACK_HOST };
