// The faces' sample code: a real TOTP (RFC 6238; SHA-1, six digits, 30
// seconds), generated from the RFC's own published test secret, the same one
// the store images were made with (GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ in
// Base32). It is nobody's account.
const SECRET = new TextEncoder().encode('12345678901234567890');

let key: Promise<CryptoKey> | null = null;

export async function sampleCode(epoch: number) {
  key ??= crypto.subtle.importKey(
    'raw',
    SECRET,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counter = new DataView(new ArrayBuffer(8));
  counter.setUint32(4, Math.floor(epoch / 30));
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', await key, counter.buffer),
  );
  const offset = mac[19] & 15;
  const value =
    (((mac[offset] & 127) << 24) |
      (mac[offset + 1] << 16) |
      (mac[offset + 2] << 8) |
      mac[offset + 3]) %
    1_000_000;
  return String(value).padStart(6, '0');
}
