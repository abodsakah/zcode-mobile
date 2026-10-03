# zcode-mobile-pairing

Pair the ZCode mobile app (the `apps/mobile` Android client built in this fork) to this Mac from the
desktop UI — no CLI, no manual server setup.

## What `/pair-mobile` does

1. Reuses a still-running pairing server from a previous run if there is one.
2. Ensures the fork's HTTP/WebSocket server is built (`packages/server/dist/entry-http.js`).
3. Binds it to this Mac's Tailscale IP only (falls back to LAN Wi-Fi with a warning), on a free port
   starting at 3141, protected by a freshly generated random token.
4. Waits for `/api/server-info` to answer, then renders a scannable QR code with the pairing URL
   `http://<ip>:<port>/?server=<ip>:<port>&token=<token>` — the URL the mobile app consumes on
   first launch.
5. Prints the phone-side steps and the stop one-liner.

State lives in `~/.zcode-mobile/` (`pairing-server.pid`, `pairing-server.env`,
`pairing-server.log`). The token never appears anywhere except the pairing output.

## Security

The server grants agent access to this Mac. Binding to the Tailscale interface plus a random token
is the intended boundary; do not rebind it to `0.0.0.0` on an untrusted network.

## Install (local dev marketplace)

Plugin Marketplace → Add → Add Plugin Marketplace → paste
`/Users/abodsakka/Documents/git/personal/zcode-mobile/plugins` → then Personal →
**ZCode Mobile Pairing** → Install. After that, type `/pair-mobile` in any desktop chat.
