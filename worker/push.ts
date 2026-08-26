/**
 * Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) over WebCrypto.
 * Enough for the Cloudflare Workers runtime — the Node `web-push` library
 * cannot run there.
 */

const VAPID_EXP_TTL_S = 12 * 60 * 60 // 12 h
const PAYLOAD_TTL_S = 24 * 60 * 60

interface PushKeys {
  p256dh: string
  auth: string
}

interface PushSubscriptionLike {
  endpoint: string
  keys: PushKeys
}

interface VapidConfig {
  privateKeyB64url: string
  publicKeyB64url: string
  subject: string
}

// ── base64url helpers ─────────────────────────────────────
const b64urlToBytes = (input: string): Uint8Array => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const bytesToB64url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── VAPID JWT (ES256) ─────────────────────────────────────
const vapidAuthorizationHeader = async (
  audience: string,
  config: VapidConfig
): Promise<string> => {
  const pubBytes = b64urlToBytes(config.publicKeyB64url)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65)),
    d: bytesToB64url(b64urlToBytes(config.privateKeyB64url)),
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const header = bytesToB64url(
    new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  )
  const payload = bytesToB64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + VAPID_EXP_TTL_S,
        sub: config.subject,
      })
    )
  )
  const signingInput = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  )
  // Raw ECDSA signature → r||s (JWT format)
  const sigBytes = new Uint8Array(signature)
  const r = sigBytes.slice(0, 32)
  const s = sigBytes.slice(32, 64)
  return `vapid t=${signingInput}.${bytesToB64url(
    new Uint8Array([...r, ...s])
  )}, k=${bytesToB64url(pubBytes)}`
}

// ── Payload encryption (aes128gcm, RFC 8291) ──────────────
const hkdf = async (
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    'raw',
    ikm as BufferSource,
    'HKDF',
    false,
    ['deriveBits']
  )
  const bits = (await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      info: info as unknown as BufferSource,
    },
    key,
    lengthBytes * 8
  ))
  return new Uint8Array(bits)
}

const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

const encryptPayload = async (
  payload: string,
  sub: PushSubscriptionLike
): Promise<Uint8Array> => {
  const uaPublic = b64urlToBytes(sub.keys.p256dh)
  const authSecret = b64urlToBytes(sub.keys.auth)

  const asKeys = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ))
  const asPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', asKeys.publicKey)
  )
  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey },
      asKeys.privateKey,
      256
    )
  )

  const nul = new Uint8Array([0])

  // RFC 8291 §3.3: PRK = HMAC-SHA256(auth_secret, ecdh_secret);
  //   IKM = HKDF-Expand(PRK, "WebPush: info\0" || ua_pub || as_pub, 32)
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info'),
    nul,
    uaPublic,
    asPublicRaw
  )
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32)

  // RFC 8188 §2.1: random salt, then
  //   PRK' = HMAC-SHA256(salt, IKM)
  //   CEK = HKDF-Expand(PRK', "Content-Encoding: aes128gcm\0", 16)
  //   NONCE = HKDF-Expand(PRK', "Content-Encoding: nonce\0", 12)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cekInfo = concatBytes(
    new TextEncoder().encode('Content-Encoding: aes128gcm'),
    nul
  )
  const cek = await hkdf(ikm, salt, cekInfo, 16)
  const nonceInfo = concatBytes(
    new TextEncoder().encode('Content-Encoding: nonce'),
    nul
  )
  const nonce = await hkdf(ikm, salt, nonceInfo, 12)

  // RFC 8188 §2: append the "last record" delimiter (0x02) to the
  // plaintext *before* encrypting — it must be inside the AEAD boundary.
  const plaintext = new TextEncoder().encode(payload)
  const paddedPlaintext = concatBytes(plaintext, new Uint8Array([2]))
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      await crypto.subtle.importKey(
        'raw',
        cek as unknown as BufferSource,
        'AES-GCM',
        false,
        ['encrypt']
      ),
      paddedPlaintext as BufferSource
    )
  )

  // aes128gcm header: salt(16) | rs(4 BE) | idlen(1) | as_public(65)
  const rs = 4096
  const header = new Uint8Array(21 + asPublicRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs)
  header[20] = asPublicRaw.length
  header.set(asPublicRaw, 21)

  return concatBytes(header, record)
}

/** Send one push. Returns HTTP status from the push service. */
export const sendPush = async (
  subscription: PushSubscriptionLike,
  payloadJson: string,
  vapid: VapidConfig
): Promise<number> => {
  const encrypted = await encryptPayload(payloadJson, subscription)
  const audience = new URL(subscription.endpoint).origin
  const authorization = await vapidAuthorizationHeader(audience, vapid)

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(PAYLOAD_TTL_S),
      Urgency: 'high',
    },
    body: encrypted as unknown as BodyInit,
  })
  return response.status
}
