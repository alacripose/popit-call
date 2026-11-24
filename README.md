# Popit Call

A contact book and signed call desk for agents. The published page is the mobile UI and the
GitHub landing surface; the companion is the local call transport. No private key is ever
written into the page.

- Published page: `https://alacripose.github.io/popit-call/`
- Repository: `https://github.com/alacripose/popit-call`
- Protocol: [ENVELOPE.md](ENVELOPE.md)
- Contour: the same `contour.js` and `contour.json` as the Popit shell

## What is here

| File | Purpose |
|---|---|
| `index.html` | Landing page, contact book, MCP surface register, signed package loader, call deck |
| `app.js` | Local contact book, vCard import, JSON export, signed call join, turn polling |
| `styles.css` | Family instrument palette, themed scrollbars, contour paint |
| `serve.py` | Loopback companion; serves this directory and proxies `/api/bridge/...` |
| `envelope.py` | Ed25519 package signing, trust registry, nonce verifier, CLI |
| `sw.js` | Offline shell; bridge and call JSON stay network-only |
| `manifest.webmanifest` | Installable standalone PWA |

## Run the companion

Popit must already be running with an open call line. Then:

```sh
python serve.py --port 5220 --bridge http://127.0.0.1:5207
```

Open `http://127.0.0.1:5220/`. Loopback is a secure context, so the PWA installs and the
service worker can run. The page's bridge field is blank on purpose; blank means
`/api/bridge`, which this companion proxies to the loopback bridge.

The companion is not a second server for the internet. A remote caller uses the host's
HTTPS surface and the same signed envelope; see below.

## Publish the landing page

The repository root is already the static site. GitHub Pages needs only:

1. Create `alacripose/popit-call` with this directory as the root.
2. Push `main`.
3. Set Pages to **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Enable **Enforce HTTPS**.

`.nojekyll` is present so files beginning with `_` are served. The page has no build step.
GitHub Pages cannot execute `serve.py`; a visitor who wants to join a call runs the companion
on the machine that can reach the Popit host, or points the bridge field at an HTTPS bridge
that sends CORS headers.

## Contact book

- Add a name, number, agent and MCP URL by hand.
- **Import vCard** reads `FN`, `N`, `TEL`, `URL` and ignores everything else.
- **Export JSON** writes `popit-callbook.json` with the schema `popit.callbook/1`.
- **Clear local book** removes only this browser's `localStorage` copy.

The book is local to the browser. It is not uploaded to GitHub and it is not sent to the
bridge until a call is joined.

## Agent MCP surfaces

An MCP surface is an HTTPS endpoint an agent exposes. Add its name, URL and agent. Selecting
the surface writes a client-shaped configuration into the page:

```json
{
  "mcpServers": {
    "popit-call": {
      "type": "http",
      "url": "https://agent.example/mcp"
    }
  }
}
```

The page never stores an MCP token. Put a token in the MCP client's own secret store. The
Popit call bridge reaches the joined call through `/api/toast/call/...`, not by opening the
agent's MCP endpoint from the browser.

## Sign a package

The host verifies an Ed25519 signature against `runlogs/toast/envelope-trust.json`. Generate
a caller key, write a payload, sign it, then give the public key to the host operator.

```sh
python envelope.py keygen --private caller.key --public caller.pem
python envelope.py sign --payload caller.json --key caller.key --out signed.json
python envelope.py trust --public caller.pem --name "Ada's agent" \
  --trust ../runlogs/toast/envelope-trust.json
```

A payload has these fields:

```json
{
  "schema": "popit.call-envelope/1",
  "name": "Ada's agent",
  "agent": "Buffy",
  "endpoint": "https://agent.example/mcp",
  "mcp": "https://agent.example/mcp",
  "capabilities": ["call.join", "call.turns", "call.say", "call.leave"],
  "nonce": "0123456789abcdef0123456789abcdef",
  "issued_at": "2026-11-24T12:00:00Z",
  "expires_at": "2026-11-24T12:30:00Z"
}
```

`sign` fills `public_key` from the private key and writes the signature. The nonce is
single-use and must be fresh for every join. The host accepts an envelope for 15 minutes.

Load `signed.json` into **Signed package** on the page. The call deck sends it to
`/api/toast/call/join`; the host verifies the signature, trust and nonce before it opens a
session. An unsigned `call.join` is refused with `envelope-required`.

## Connect the HTTPS client

Popit prints these on startup:

```text
popit phone https://<popit-lan-ip>:5210/phone.html
popit phone https://<popit-lan-ip>:5210/popit-cert.pem
popit phone http://<popit-lan-ip>:5209/phone.html
```

On the phone:

1. Open the `popit-cert.pem` URL and install it as a trusted root.
2. On iOS, enable full trust for the certificate in **Settings → General → About → Certificate Trust Settings**.
3. On Android, install it as a **CA certificate** under **Security → Encryption & credentials**.
4. Open `https://<popit-lan-ip>:5210/phone.html`.

The phone page writes only over HTTPS. Plain `5209` is read-only and refuses chat, voice and
envelope admission with `secure-origin-required`.

The standalone page is not the phone shell. It is the contact book and MCP desk. The phone
shell remains the Springboard at `/phone.html` with its own contour surfaces.

## Reach a host on another machine

The static page cannot open a socket by itself. One host runs the companion as a TLS
listener; every caller points **Bridge** at that origin and presents a signed package.

```sh
# on the Popit host
python serve.py --host 0.0.0.0 --port 5221 \
  --bridge http://127.0.0.1:5207 \
  --tls-cert host-cert.pem --tls-key host-key.pem \
  --public-origin https://alacripose.github.io

# in the published page's Bridge field
https://host.example:5221
```

Use a certificate whose SAN names the host the remote caller will type. Do not use a
loopback certificate for a public hostname. The companion exposes only:

- `POST /api/toast/call/join`
- `POST /api/toast/call/turns`
- `POST /api/toast/call/say`
- `POST /api/toast/call/leave`
- `GET /api/toast/civilians/scope`

The companion refuses every other bridge route with `bridge-route`; opening calls, Debian
commands, window control, archive reads and the raw toast state stay on loopback. CORS is
only sent to the exact `--public-origin`; another page gets no allow-origin header. The call
join still checks the Ed25519 package, BLAKE3 trust, 15-minute window, capability and
single-use nonce before it creates a session.

This is the remote transport, not terminal-free identity enrollment. A remote user still
needs a caller key and a host operator who trusts its public key; remote browser audio and
self-service enrollment are named as blocked in the civilian scope, not claimed here.

## Full civilian scope

The page exposes the family scope register at `/api/toast/civilians/scope` through the same
allowlist. It names every life, memory, contract and call requirement, its evidence, and its
blocker/research question. See [`../docs/civilians.md`](../docs/civilians.md) and
`../civilian_scope.py`.

## Gates

Run these from the Popit shell checkout:

```sh
python tools/gate.py
python tools/landing.py --check
python tools/secrets_gate.py --check
```

The call client has its own check:

```sh
python tools/call_client_gate.py
```

A pass means the contour, prose, secret and protocol checks hold on disk. It does not mean
GitHub Pages has propagated, and it does not mean a remote caller has a key in the trust
registry.

## Boundaries

- The page never holds a private key or a bridge token.
- A signed package is not a grant of shell access; it admits one caller to one open call.
- A nonce is consumed on admission. Replaying the same package is `envelope-replay`.
- An untrusted public key is `envelope-untrusted`; the registry is the only trust anchor.
- The companion does not run commands. It serves files and forwards JSON.
