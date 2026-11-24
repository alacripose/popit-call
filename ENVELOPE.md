# Popit call envelope v1

An outside caller proves who it is by signing one JSON object. The Popit host checks the
signature, the trust registry, the time window and the nonce before it opens a bridge
session. The name in the signed package is the lane name; an unsigned `agent` field is not
an identity.

## Schema

```json
{
  "schema": "popit.call-envelope/1",
  "name": "Ada's agent",
  "agent": "Buffy",
  "endpoint": "https://agent.example/mcp",
  "mcp": "https://agent.example/mcp",
  "capabilities": ["call.join", "call.turns", "call.say", "call.leave"],
  "issued_at": "2026-11-24T12:00:00Z",
  "expires_at": "2026-11-24T12:30:00Z",
  "nonce": "0123456789abcdef0123456789abcdef",
  "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "signature_algorithm": "ed25519",
  "signature": "base64..."
}
```

The signed fields are exactly, in sorted key order and with no whitespace:

`agent`, `capabilities`, `endpoint`, `expires_at`, `issued_at`, `mcp`, `name`, `nonce`,
`public_key`, `schema`.

`name`, `agent`, `endpoint`, `capabilities`, `issued_at`, `nonce` and `public_key` are
required. `expires_at` and `mcp` may be empty. `signature`, `signature_algorithm` and the
envelope's own metadata are outside the signed bytes.

## Canonical bytes

```text
json.dumps({field: envelope[field] for field in SIGNED_FIELDS},
           sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
```

That is the exact byte string OpenSSL signs. Changing a field, reordering a list or adding a
field to the signed set is a new protocol, not a compatible package.

## Signature

- Algorithm: Ed25519.
- Key format: PEM SubjectPublicKeyInfo, `BEGIN PUBLIC KEY`.
- Signature: 64 raw bytes, base64.
- Host command: `openssl pkeyutl -verify -pubin -inkey caller.pem -rawin -in message -sigfile signature`.
- Fingerprint: `blake3:` plus BLAKE3 of the PEM text with each line stripped and one trailing
  newline.

The host does not trust a key because it is present in the package. It looks up the
fingerprint in `runlogs/toast/envelope-trust.json`:

```json
{
  "schema": "popit.envelope-trust/1",
  "keys": [
    {
      "name": "Ada's agent",
      "fingerprint": "blake3:...",
      "public_key": "-----BEGIN PUBLIC KEY-----\n...",
      "added_at": "2026-11-24T12:00:00Z"
    }
  ]
}
```

A missing registry is `envelope-trust-absent`. A key not in the registry is
`envelope-untrusted`. A revoked row is ignored.

## Admission rules

| Rule | Refusal |
|---|---|
| Schema is not `popit.call-envelope/1` | `envelope-schema` |
| Required signed field is missing | `envelope-field` |
| `endpoint` is not `https://` | `envelope-endpoint` |
| `call.join` is absent from capabilities | `envelope-capability` |
| Nonce is not 32–64 lowercase hex | `envelope-nonce` |
| `issued_at` is more than 15 minutes old | `envelope-expired` |
| `issued_at` is more than 2 minutes in the future | `envelope-time` |
| `expires_at` is past or more than one hour after issue | `envelope-expiry` |
| Signature is not 64-byte base64 | `envelope-signature` |
| Signature does not verify | `envelope-signature` |
| Fingerprint is not in the trust registry | `envelope-untrusted` |
| Nonce was already admitted | `envelope-replay` |
| Package is larger than 16 KiB | `envelope-oversize` |

The nonce store is `runlogs/toast/envelope-nonces.json`. A nonce is consumed only after the
signature and trust checks pass. A failed package does not burn a nonce.

## Host endpoints

### `POST /api/toast/envelope/admit`

Body:

```json
{ "envelope": { "...": "signed package" } }
```

Response:

```json
{
  "ok": true,
  "admission": {
    "admitted": true,
    "caller": "Ada's agent",
    "agent": "Buffy",
    "endpoint": "https://agent.example/mcp",
    "capabilities": ["call.join", "call.turns", "call.say", "call.leave"],
    "fingerprint": "blake3:...",
    "nonce": "0123456789abcdef0123456789abcdef",
    "issued_at": "2026-11-24T12:00:00Z",
    "admitted_at": "2026-11-24T12:00:01Z"
  }
}
```

Admission is informational; it consumes the nonce. Join with a fresh package.

### `POST /api/toast/call/join`

Body:

```json
{
  "agent": "Buffy",
  "profile": "buffy",
  "envelope": { "...": "signed package" }
}
```

The envelope's `agent` is authoritative. The route verifies and consumes the nonce, then
opens the bridge session. A request without an envelope is `envelope-required`.

The local MCP edge at `/mcp` keeps its loopback `call.join`; it is already on the host and
does not cross the public line. Do not expose `/mcp` as the internet caller surface.

### `POST /api/toast/call/turns`, `call.say`, `call.leave`

These use the session returned by `call/join`. A session is not a package and cannot be
moved to another bridge.

## What this does not do

The package does not grant shell access, file access or microphone control. It admits one
caller to one open call line. The host still decides whether an open call exists for that
agent name; if it does not, the join is `bridge-line-absent`.
