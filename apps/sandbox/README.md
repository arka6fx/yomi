# Yomi computer

A private cloud desktop for each Yomi user: an isolated Linux sandbox running
Xvfb, Chrome, and a small control service. The agent drives it for computer-use
tasks, and the user can watch it live from the dashboard.

## How it works

```text
FastAPI backend ──HTTPS + COMPUTER_GATEWAY_SECRET──► yomi-computer Worker (worker/computer.ts)
                                                        │  Cloudflare Sandbox SDK
                                                        ▼
                                                 sandbox yomi-<user id>
                                                 image/: Xvfb · Chrome · control service (:8081)
```

- The Worker maps each user to a sandbox (`yomi-<workspace>`) and forwards
  commands to the control service inside it. Per-user authorization happens in
  the Python backend. The Worker checks one deployment secret, plus a signed
  viewer token for the live view.
- Desktops sleep after five idle minutes. The Chrome profile (cookies, saved
  logins, local storage) is backed up before sleep and restored on wake, so
  logins persist.

## Layout

```text
worker/computer.ts      Gateway Worker and the Computer sandbox class
image/Dockerfile        Desktop image
image/startup.sh        Boots Xvfb, the VNC bridge, and the control service
image/control/          Control service (Python): Chrome lifecycle and browser actions
wrangler.toml           Production (yomi-computer)
wrangler.staging.toml   Staging
```

## Deploy

The image needs Docker to build, so it deploys from CI:
`.github/workflows/deploy-computer.yml` runs on pushes to `main` that touch
`apps/sandbox/**`, or on demand. Set the shared secret once per environment:

```bash
npx wrangler secret put COMPUTER_GATEWAY_SECRET --config wrangler.toml
```

Use the same value for `COMPUTER_GATEWAY_SECRET` on the `yomi-backend` Worker,
and set `COMPUTER_GATEWAY_URL` there to this Worker's URL.
