---
description: Pair the ZCode mobile app to this Mac — starts a local pairing server and shows a scannable QR
---

Pair the user's ZCode mobile app (Android, installed from the zcode-mobile fork's debug APK) to this Mac.
Execute every step with your shell tools; report each failure plainly and stop at the first blocker you
cannot resolve — never fake a successful pairing.

All fixed paths below refer to the fork repo at `/Users/abodsakka/Documents/git/personal/zcode-mobile`
("the repo") and the state directory `~/.zcode-mobile` (create it if missing).

## Step 1 — Reuse an existing pairing server if one is alive

If `~/.zcode-mobile/pairing-server.pid` exists and `kill -0 $(cat ~/.zcode-mobile/pairing-server.pid)`
succeeds, a pairing server from a previous run is still up. Read its port and token from
`~/.zcode-mobile/pairing-server.env` (the launch step writes them there), verify
`curl -s --max-time 3 "http://127.0.0.1:<port>/api/server-info?token=<token>"` returns JSON containing
`"workspaces"`, and skip straight to Step 7 with the existing values.

## Step 2 — Ensure the pairing server is built

Check that `packages/server/dist/entry-http.js` exists in the repo. If it does not, run
`pnpm --filter @zcode/server build` from the repo root and confirm the file appears. A plain
`node packages/server/dist/entry-http.js` only works after this real tsup build (it embeds the
provider config); if launch later fails with "未嵌入 ZCode Built-in Provider Config", the build was
stale — rebuild and retry once.

## Step 3 — Choose the network address

Run `tailscale ip -4`. If it prints a 100.x.y.z address, that is the bind IP. If it prints nothing
("Tailscale is stopped"), run `open -a Tailscale`, wait 8 seconds, and retry once. If Tailscale still
gives no address, fall back to `ipconfig getifaddr en0` and say clearly in the final output that the
pairing only works on the local Wi-Fi network, not remotely. If neither yields an IP, stop and report.

## Step 4 — Pick a free port and generate the token

Default port: 3141. If `lsof -nP -iTCP:3141 -sTCP:LISTEN` shows any listener, bump to 3142, 3143, …
until free (check each). Generate the token with `openssl rand -hex 16`.

## Step 5 — Launch the pairing server

From the repo's `packages/server` directory run:

```
PORT=<port> ZCODE_SERVER_HOST=<bind-ip> ZCODE_SERVER_AUTH_TOKEN=<token> \
  nohup node dist/entry-http.js >> ~/.zcode-mobile/pairing-server.log 2>&1 &
echo $! > ~/.zcode-mobile/pairing-server.pid
```

Write `PORT=<port>`, `TOKEN=<token>`, `BIND_IP=<bind-ip>` into `~/.zcode-mobile/pairing-server.env`.
Binding to the exact Tailscale IP (not 0.0.0.0) is deliberate: only devices on the user's own tailnet
can reach the server. Never print the token anywhere except the pairing output in the final step.

## Step 6 — Wait for it to come up

Poll up to 30 seconds: `curl -s --max-time 3 "http://127.0.0.1:<port>/api/server-info?token=<token>"`
until the response contains `"workspaces"`. On timeout, read the last 20 lines of
`~/.zcode-mobile/pairing-server.log`, include them in your report, and stop.

## Step 7 — Compose the pairing URL and render the QR

The URL is `http://<bind-ip>:<port>/?server=<bind-ip>:<port>&token=<token>` (the mobile app reads
`?server=` and `?token=` on first launch and stores them). Render a scannable QR in a fenced code
block: use `qrencode -t UTF8i "<url>"` if qrencode is installed, otherwise
`npx -y qrcode-terminal "<url>"`. If neither works, say so and rely on the copy-paste URL alone.

## Step 8 — Output

Present exactly this, in this order:

1. The QR code (fenced code block).
2. The pairing URL on its own line in an inline code block, for copy-paste.
3. Phone steps, briefly: Tailscale ON on the phone (same tailnet) → open the ZCode app → paste the
   URL (or scan the QR with any scanner and open it) → the app connects and lists this Mac's sessions.
4. The stop one-liner: `kill $(cat ~/.zcode-mobile/pairing-server.pid)` — and note the server keeps
   running until then.
5. If the bind IP came from the Wi-Fi fallback (Step 3), repeat the local-network-only warning here.
