/**
 * HTTP Message Signatures (RFC 9421) — request signing for outbound API calls.
 *
 * Signs requests to opensocial.community using the app's private key.
 * The server verifies signatures using the public key from our CIMD document.
 */

import crypto from 'crypto';

export interface SigningConfig {
  /** PEM-encoded private key */
  privateKey: string;
  /** Key ID used in Signature-Input (matches the key ID in CIMD) */
  keyId: string;
  /** Signing algorithm: 'ed25519', 'ecdsa-p256', or 'rsa-pss-sha256' */
  algorithm: 'ed25519' | 'ecdsa-p256' | 'rsa-pss-sha256';
}

interface RequestComponents {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Sign an outbound HTTP request per RFC 9421.
 * Returns the headers to add to the request (Signature-Input + Signature).
 */
export function signRequest(
  request: RequestComponents,
  config: SigningConfig
): { 'Signature-Input': string; Signature: string; 'Content-Digest'?: string } {
  const { method, url, headers, body } = request;
  const parsedUrl = new URL(url);

  const created = Math.floor(Date.now() / 1000).toString();
  const label = 'sig1';

  // Determine which components to sign
  const components: string[] = ['"@method"', '"@path"'];
  const componentValues: string[] = [method.toUpperCase(), parsedUrl.pathname];

  // Add content-digest for requests with body
  const result: Record<string, string> = {};
  if (body) {
    const digest = crypto.createHash('sha256').update(body).digest('base64');
    result['Content-Digest'] = `sha-256=:${digest}:`;
    components.push('"content-digest"');
    componentValues.push(result['Content-Digest']);
  }

  // Build signature base
  const signatureBase = components
    .map((comp, i) => `${comp}: ${componentValues[i]}`)
    .join('\n');

  const params = `(${components.join(' ')});created=${created};keyid="${config.keyId}"`;
  const fullBase = `${signatureBase}\n"@signature-params": ${params}`;

  // Sign
  const signature = signWithKey(fullBase, config);
  const sigBase64 = signature.toString('base64');

  result['Signature-Input'] = `${label}=${params}`;
  result['Signature'] = `${label}=:${sigBase64}:`;

  return result as any;
}

function signWithKey(data: string, config: SigningConfig): Buffer {
  const dataBuffer = Buffer.from(data, 'utf-8');

  switch (config.algorithm) {
    case 'ed25519':
      return Buffer.from(crypto.sign(null, dataBuffer, config.privateKey));

    case 'ecdsa-p256': {
      const signer = crypto.createSign('SHA256');
      signer.update(dataBuffer);
      return signer.sign(config.privateKey);
    }

    case 'rsa-pss-sha256': {
      const signer = crypto.createSign('SHA256');
      signer.update(dataBuffer);
      return signer.sign({
        key: config.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      });
    }

    default:
      throw new Error(`Unsupported signing algorithm: ${config.algorithm}`);
  }
}

/**
 * Export the public key from a private key as JWK (for CIMD document).
 */
export function publicKeyToJwk(
  privateKeyPem: string,
  algorithm: SigningConfig['algorithm']
): crypto.JsonWebKey {
  const keyObj = crypto.createPublicKey(privateKeyPem);
  const jwk = keyObj.export({ format: 'jwk' });

  // Add alg field based on algorithm
  switch (algorithm) {
    case 'ed25519':
      jwk.alg = 'EdDSA';
      break;
    case 'ecdsa-p256':
      jwk.alg = 'ES256';
      break;
    case 'rsa-pss-sha256':
      jwk.alg = 'PS256';
      break;
  }

  jwk.use = 'sig';
  jwk.kid = 'collective-social-key-1';
  return jwk;
}
