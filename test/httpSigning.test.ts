import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  signRequest,
  publicKeyToJwk,
  type SigningConfig,
} from '../src/lib/httpSigning';

// Generate test key pairs for each algorithm
function generateEd25519Key() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

function generateEcdsaP256Key() {
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

function generateRsaKey() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

describe('httpSigning', () => {
  describe('signRequest', () => {
    it('produces Signature-Input and Signature headers (Ed25519)', () => {
      const config: SigningConfig = {
        privateKey: generateEd25519Key(),
        keyId: 'test-key',
        algorithm: 'ed25519',
      };

      const result = signRequest(
        {
          method: 'GET',
          url: 'https://example.com/api/v1/communities',
          headers: {},
        },
        config
      );

      expect(result['Signature-Input']).toMatch(
        /^sig1=\("@method" "@path"\);created=\d+;keyid="test-key"$/
      );
      expect(result['Signature']).toMatch(/^sig1=:[A-Za-z0-9+/]+=*:$/);
      expect(result['Content-Digest']).toBeUndefined();
    });

    it('includes Content-Digest for requests with body', () => {
      const config: SigningConfig = {
        privateKey: generateEd25519Key(),
        keyId: 'test-key',
        algorithm: 'ed25519',
      };

      const body = JSON.stringify({ user_did: 'did:plc:test' });
      const result = signRequest(
        {
          method: 'POST',
          url: 'https://example.com/api/v1/communities',
          headers: {},
          body,
        },
        config
      );

      expect(result['Content-Digest']).toMatch(/^sha-256=:[A-Za-z0-9+/]+=*:$/);
      expect(result['Signature-Input']).toContain('"content-digest"');
    });

    it('signature is verifiable with the public key (Ed25519)', () => {
      const pem = generateEd25519Key();
      const config: SigningConfig = {
        privateKey: pem,
        keyId: 'test-key',
        algorithm: 'ed25519',
      };

      const url = 'https://example.com/api/v1/test';
      const result = signRequest({ method: 'GET', url, headers: {} }, config);

      // Extract and reconstruct signature base
      const sigInput = result['Signature-Input'].replace('sig1=', '');
      const parsedUrl = new URL(url);
      const signatureBase = `"@method": GET\n"@path": ${parsedUrl.pathname}\n"@signature-params": ${sigInput}`;

      // Extract raw signature
      const sigMatch = result['Signature'].match(/^sig1=:(.+):$/);
      const sigBytes = Buffer.from(sigMatch![1], 'base64');

      // Verify with public key
      const publicKey = crypto.createPublicKey(pem);
      const valid = crypto.verify(
        null,
        Buffer.from(signatureBase),
        publicKey,
        sigBytes
      );
      expect(valid).toBe(true);
    });

    it('signature is verifiable with the public key (ECDSA P-256)', () => {
      const pem = generateEcdsaP256Key();
      const config: SigningConfig = {
        privateKey: pem,
        keyId: 'test-key',
        algorithm: 'ecdsa-p256',
      };

      const url = 'https://example.com/api/v1/test';
      const result = signRequest({ method: 'GET', url, headers: {} }, config);

      const sigInput = result['Signature-Input'].replace('sig1=', '');
      const parsedUrl = new URL(url);
      const signatureBase = `"@method": GET\n"@path": ${parsedUrl.pathname}\n"@signature-params": ${sigInput}`;

      const sigMatch = result['Signature'].match(/^sig1=:(.+):$/);
      const sigBytes = Buffer.from(sigMatch![1], 'base64');

      const publicKey = crypto.createPublicKey(pem);
      const valid = crypto
        .createVerify('SHA256')
        .update(signatureBase)
        .verify(publicKey, sigBytes);
      expect(valid).toBe(true);
    });

    it('signature is verifiable with the public key (RSA-PSS)', () => {
      const pem = generateRsaKey();
      const config: SigningConfig = {
        privateKey: pem,
        keyId: 'test-key',
        algorithm: 'rsa-pss-sha256',
      };

      const url = 'https://example.com/api/v1/test';
      const body = '{"test":true}';
      const result = signRequest(
        { method: 'POST', url, headers: {}, body },
        config
      );

      const sigInput = result['Signature-Input'].replace('sig1=', '');
      const parsedUrl = new URL(url);
      const signatureBase = `"@method": POST\n"@path": ${parsedUrl.pathname}\n"content-digest": ${result['Content-Digest']}\n"@signature-params": ${sigInput}`;

      const sigMatch = result['Signature'].match(/^sig1=:(.+):$/);
      const sigBytes = Buffer.from(sigMatch![1], 'base64');

      const publicKey = crypto.createPublicKey(pem);
      const valid = crypto
        .createVerify('SHA256')
        .update(signatureBase)
        .verify(
          {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          },
          sigBytes
        );
      expect(valid).toBe(true);
    });

    it('different requests produce different signatures', () => {
      const config: SigningConfig = {
        privateKey: generateEd25519Key(),
        keyId: 'test-key',
        algorithm: 'ed25519',
      };

      const r1 = signRequest(
        { method: 'GET', url: 'https://example.com/api/v1/a', headers: {} },
        config
      );
      const r2 = signRequest(
        { method: 'GET', url: 'https://example.com/api/v1/b', headers: {} },
        config
      );

      expect(r1['Signature']).not.toBe(r2['Signature']);
    });
  });

  describe('publicKeyToJwk', () => {
    it('exports Ed25519 public key as JWK', () => {
      const pem = generateEd25519Key();
      const jwk = publicKeyToJwk(pem, 'ed25519');

      expect(jwk.kty).toBe('OKP');
      expect(jwk.crv).toBe('Ed25519');
      expect(jwk.alg).toBe('EdDSA');
      expect(jwk.use).toBe('sig');
      expect(jwk.kid).toBe('collective-social-key-1');
      // Should not contain private key material
      expect(jwk.d).toBeUndefined();
    });

    it('exports ECDSA P-256 public key as JWK', () => {
      const pem = generateEcdsaP256Key();
      const jwk = publicKeyToJwk(pem, 'ecdsa-p256');

      expect(jwk.kty).toBe('EC');
      expect(jwk.crv).toBe('P-256');
      expect(jwk.alg).toBe('ES256');
      expect(jwk.d).toBeUndefined();
    });

    it('exports RSA public key as JWK', () => {
      const pem = generateRsaKey();
      const jwk = publicKeyToJwk(pem, 'rsa-pss-sha256');

      expect(jwk.kty).toBe('RSA');
      expect(jwk.alg).toBe('PS256');
      expect(jwk.d).toBeUndefined();
    });
  });
});
