/** @jest-environment node */

import { webcrypto } from 'crypto';

import { signOidcSession, verifyOidcSession } from './oidc-session';

describe('OIDC session signature', () => {
  const originalPassword = process.env.PASSWORD;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });

  beforeEach(() => {
    process.env.PASSWORD = 'oidc-test-secret';
  });

  afterAll(() => {
    if (originalPassword === undefined) delete process.env.PASSWORD;
    else process.env.PASSWORD = originalPassword;
  });

  it('accepts a signed session and rejects altered identity or trust level', async () => {
    const value = await signOidcSession({ sub: 'user-123', trust_level: 1 });
    expect(await verifyOidcSession(value)).toMatchObject({ sub: 'user-123', trust_level: 1 });

    const session = JSON.parse(value);
    for (const change of [{ sub: 'admin' }, { trust_level: 4 }]) {
      expect(await verifyOidcSession(JSON.stringify({ ...session, ...change }))).toBeNull();
    }
  });

  it('rejects unsigned, malformed and differently signed sessions', async () => {
    expect(await verifyOidcSession('{')).toBeNull();
    expect(await verifyOidcSession(JSON.stringify({ sub: 'admin', timestamp: Date.now() }))).toBeNull();
    const value = await signOidcSession({ sub: 'user-123' });
    process.env.PASSWORD = 'different-secret';
    expect(await verifyOidcSession(value)).toBeNull();
    delete process.env.PASSWORD;
    expect(await verifyOidcSession(value)).toBeNull();
  });
});
