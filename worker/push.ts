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
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: '',
    y: '',
    d: bytesToB64url(b64urlToBytes(config.privateKeyB64url)),
  }
  // Derive public point from the private scalar
  const priv = b64urlToBytes(config.privateKeyB64url)
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, d: bytesToB64url(priv) },
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  )
  const rawPub = (await crypto.subtle.exportKey(
    'raw',
    key
  ))
  const pubBytes = new Uint8Array(rawPub)
  jwk.x = bytesToB64url(pubBytes.slice(1, 33))
  jwk.y = bytesToB64url(pubBytes.slice(33, 65))

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
  length: number
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
    length
  ))
  return new Uint8Array(bits)
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
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublic } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0],
      asKeys.privateKey,
      256
    )
  )

  // RFC 8291 §3.3: PRK_key = HKDF(auth_salt, ecdh, info, 16) → CEK
  const keyInfo = new TextEncoder().encode(
    'WebPush: info\0' + String.fromCharCode(...uaPublic, ...asPublicRaw)
  )
  const cek = new Uint8Array(
    await hkdf(ecdhSecret, authSecret, keyInfo, 16)
  )

  // §3.4: NONCE = HKDF(PRK_key, as_public, nonce_info, 12)
  const nonceInfo = new TextEncoder().encode(
    'WebPush: nonce\0' + String.fromCharCode(...uaPublic, ...asPublicRaw)
  )
  const nonce = await hkdf(cek, asPublicRaw, nonceInfo, 12)

  const plaintext = new TextEncoder().encode(payload)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      await crypto.subtle.importKey(
        'raw',
        cek as unknown as BufferSource,
        'AES-GCM',
        false,
        ['encrypt']
      ),
      plaintext
    )
  )

  // aes128gcm header: salt(16) | rs(4 BE) | idlen(1) | as_public(65)
  const rs = 4096
  const header = new Uint8Array(21 + asPublicRaw.length)
  header.set(crypto.getRandomValues(new Uint8Array(16)), 0)
  new DataView(header.buffer).setUint32(16, rs)
  header[20] = asPublicRaw.length
  header.set(asPublicRaw, 21)

  // body: ciphertext + auth tag delimiter byte 0x02
  const record = new Uint8Array(ciphertext.length + 1)
  record.set(ciphertext, 0)
  record[ciphertext.length] = 2

  return new Uint8Array([...header, ...record])
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
    },
    body: encrypted as unknown as BodyInit,
  })
  return response.status
}
