import { describe, it, expect } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveBindHost, LOOPBACK_HOST } = require('./bindHost.js');

describe('resolveBindHost', () => {
  it('defaults to loopback when HOST is unset', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1');
    expect(LOOPBACK_HOST).toBe('127.0.0.1');
  });

  it('defaults to loopback when HOST is blank or whitespace', () => {
    expect(resolveBindHost({ HOST: '' })).toBe('127.0.0.1');
    expect(resolveBindHost({ HOST: '   ' })).toBe('127.0.0.1');
  });

  it('lets a deliberate HOST opt out of loopback', () => {
    expect(resolveBindHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ HOST: ' 10.0.0.5 ' })).toBe('10.0.0.5');
  });
});

// The unit cases above only prove the string. These prove the socket: a server
// started the way server/index.js starts it is bound to loopback only, and is
// NOT reachable on this machine's other interfaces.
describe('default bind is loopback in practice', () => {
  function listenOnDefaultHost() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => res.end('ok'));
      server.once('error', reject);
      // Port 0 = let the OS pick; the host is what's under test.
      server.listen(0, resolveBindHost({}), () => resolve(server));
    });
  }

  function connect(host, port) {
    return new Promise(resolve => {
      const socket = net.connect({ host, port });
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve({ connected: true }); });
      socket.once('timeout', () => { socket.destroy(); resolve({ connected: false, code: 'ETIMEDOUT' }); });
      socket.once('error', err => { socket.destroy(); resolve({ connected: false, code: err.code }); });
    });
  }

  it('reports a loopback address and refuses non-loopback interfaces', async () => {
    const server = await listenOnDefaultHost();
    try {
      const { address, port } = server.address();
      expect(address).toBe('127.0.0.1');

      expect((await connect('127.0.0.1', port)).connected).toBe(true);

      // Every non-internal IPv4 this box owns (LAN/public NIC addresses) must be
      // closed. If the bind ever regresses to a wildcard, these connect.
      const external = Object.values(os.networkInterfaces())
        .flat()
        .filter(nic => nic && nic.family === 'IPv4' && !nic.internal)
        .map(nic => nic.address);

      for (const host of external) {
        const result = await connect(host, port);
        expect(result.connected, `${host}:${port} should not be reachable`).toBe(false);
      }
    } finally {
      await new Promise(done => server.close(done));
    }
  });
});
