// A software authenticator for protocol tests: real ES256 keys and signatures.
// It exercises production verification without requiring a biometric prompt.
const { randomBytes, createHash, generateKeyPairSync, sign } = require('node:crypto');
const { encodeCBOR } = require('@levischuck/tiny-cbor');
const hash = value => createHash('sha256').update(value).digest();
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const idBytes = randomBytes(32), id = idBytes.toString('base64url');
  let counter = 0;
  const client = (type, options, origin) => Buffer.from(JSON.stringify({ type, challenge: options.challenge, origin, crossOrigin: false }));
  return {
    id,
    register(options, origin, { verified = true } = {}) {
      const data = client('webauthn.create', options, origin);
      const cose = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length);
      const auth = Buffer.concat([hash(options.rp.id), Buffer.from([verified ? 0x45 : 0x41]), Buffer.alloc(4), Buffer.alloc(16), length, idBytes, cose]);
      const attestationObject = Buffer.from(encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', auth]]))).toString('base64url');
      return { id, rawId: id, type: 'public-key', response: { clientDataJSON: data.toString('base64url'), attestationObject, transports: ['internal'] }, clientExtensionResults: {} };
    },
    authenticate(options, origin, { verified = true, rpID = options.rpId } = {}) {
      const data = client('webauthn.get', options, origin);
      const count = Buffer.alloc(4); count.writeUInt32BE(++counter);
      const auth = Buffer.concat([hash(rpID), Buffer.from([verified ? 0x05 : 0x01]), count]);
      const signature = sign('sha256', Buffer.concat([auth, hash(data)]), privateKey);
      return { id, rawId: id, type: 'public-key', response: { clientDataJSON: data.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url'), userHandle: null }, clientExtensionResults: {} };
    }
  };
}
module.exports = { authenticator };
