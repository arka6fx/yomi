# Yomi Production Runbook

Current production target:

```text
https://yomi.arka6fx.com
```

Production runs on EC2 from `/opt/yomi` using Docker Compose. GitHub Actions
deploys `main` by SSH.

## Required Secrets

GitHub Actions repository secrets:

```text
EC2_HOST=yomi.arka6fx.com
EC2_SSH_KEY=<private key contents>
```

EC2 file:

```text
/opt/yomi/.env.production
```

Required production values:

```bash
DATABASE_URL=postgresql://...

BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://yomi.arka6fx.com
BETTER_AUTH_BASE_URL=https://yomi.arka6fx.com
BACKEND_URL=https://yomi.arka6fx.com
NEXT_PUBLIC_BACKEND_URL=https://yomi.arka6fx.com
NEXT_PUBLIC_APP_URL=https://yomi.arka6fx.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

OPENAI_API_KEY=...
OPENAI_BASE_URL=...

ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

ENCRYPTION_KEY=<openssl rand -hex 32>
SIDECAR_SECRET=...
```

Optional until billing is enabled:

```bash
DODO_API_KEY=
DODO_WEBHOOK_SECRET=
DODO_API_BASE=https://api.dodopayments.com
DODO_PRODUCT_PRO=
DODO_PRODUCT_MAX=
DODO_PRODUCT_CREDITS_500=
DODO_PRODUCT_CREDITS_2000=
DODO_PRODUCT_CREDITS_6000=
```

## Messaging Gateway

Yomi supports Telegram and Discord messaging bots.

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Copy the token → set `TELEGRAM_BOT_TOKEN` in `.env.production`
3. Set `TELEGRAM_BOT_USERNAME=yomi_assistant_bot`
4. Set `TELEGRAM_DEEP_LINK_ENABLED=true` for one-click onboarding via `t.me/bot?start=TOKEN`
5. The bot polls Telegram every 3s for new messages

### Discord

1. Create an application at [discord.com/developers](https://discord.com/developers/applications)
2. Under Bot tab, enable **Server Members Intent** and **Message Content Intent**
3. Under OAuth2, add `https://yomi.arka6fx.com/api/gateway/discord/callback` as a redirect URI
4. Set these in `.env.production`:

```bash
DISCORD_BOT_TOKEN=MTUxMzc2OTk4MTc3MzQ4MDA2OA.xxxxx
DISCORD_CLIENT_ID=1513769981773480068
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yomi.arka6fx.com/api/gateway/discord/callback
```

DISCORD_CLIENT_ID is hardcoded in the deploy workflow.
DISCORD_CLIENT_SECRET is set as a GitHub Actions secret and injected at deploy
time (not baked into the Docker image).

The bot connects via Gateway WebSocket and auto-registers a `/link` slash
command. See `discord.ts:331` for registration logic.

### OAuth Callback URLs

Configure in the OAuth provider dashboards:

```text
https://yomi.arka6fx.com/api/auth/callback/github
https://yomi.arka6fx.com/api/auth/callback/google
https://yomi.arka6fx.com/api/gateway/discord/callback
```

## First Server Setup

```bash
sudo apt update
sudo apt install -y docker-compose-plugin certbot
sudo mkdir -p /opt/yomi
sudo chown -R ubuntu:ubuntu /opt/yomi
git clone https://github.com/arka6fx/yomi.git /opt/yomi
cd /opt/yomi
cp .env.example .env.production
```

Fill `.env.production`, then start the app once over HTTP or temporarily stop
nginx to issue the certificate.

Certificate command used for this deployment:

```bash
cd /opt/yomi
sudo docker compose stop nginx
sudo mkdir -p deploy/certs deploy/certbot-work deploy/logs
sudo certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --config-dir /opt/yomi/deploy/certs \
  --work-dir /opt/yomi/deploy/certbot-work \
  --logs-dir /opt/yomi/deploy/logs \
  -d yomi.arka6fx.com
sudo docker compose up -d --build
```

Certbot installed a renewal timer. After renewal, recreate or reload nginx so it
uses the renewed files.

## Deploy

Automatic deploy:

```bash
git push origin main
```

Manual deploy from EC2:

```bash
cd /opt/yomi
git pull origin main
sudo docker compose --env-file .env.production up -d --build
sudo docker image prune -f
```

Manual deploy from GitHub CLI:

```bash
gh workflow run deploy.yml --repo arka6fx/yomi --ref main
```

## Verify

```bash
curl -I https://yomi.arka6fx.com/
curl https://yomi.arka6fx.com/health
sudo docker compose ps
sudo docker compose logs --tail=80 backend landing nginx
```

Expected container state:

```text
backend   healthy
landing   healthy
nginx     up, ports 80 and 443 bound
```

Expected public behavior:

```text
http://yomi.arka6fx.com/  -> 301
https://yomi.arka6fx.com/ -> 200
/_next/static/*          -> 200
```

## OAuth

Configure these callback URLs in the OAuth provider dashboards:

```text
https://yomi.arka6fx.com/api/auth/callback/github
https://yomi.arka6fx.com/api/auth/callback/google
https://yomi.arka6fx.com/api/gateway/discord/callback
```

If login attempts call `localhost:3001`, rebuild `landing` with production
public build args:

```bash
cd /opt/yomi
sudo docker compose --env-file .env.production build --no-cache landing
sudo docker compose --env-file .env.production up -d --force-recreate landing nginx
```

## Dodo Payments

Leave Dodo values blank until billing is ready. When enabling billing:

1. Generate an API key in the Dodo dashboard.
2. Set `DODO_API_KEY`.
3. Create subscription products for Pro and Max.
4. Create one-time products for the credit packs.
5. Set `DODO_PRODUCT_PRO`, `DODO_PRODUCT_MAX`, and credit-pack product IDs.
6. Add a webhook for `https://yomi.arka6fx.com/api/billing/webhook`.
7. Set `DODO_WEBHOOK_SECRET` to the webhook signing secret.
8. Update `.env.production` and redeploy:

```bash
cd /opt/yomi
sudo docker compose up -d --force-recreate backend nginx
```

## Troubleshooting

SSH deploy timeout:

- Check EC2 security group allows GitHub Actions runners or use a self-hosted
  runner.
- Confirm `EC2_HOST` points to `yomi.arka6fx.com`.

Port 80/443 in use:

```bash
sudo ss -ltnp '( sport = :80 or sport = :443 )'
sudo systemctl disable --now nginx
sudo docker compose up -d nginx
```

White page:

```bash
curl -I https://yomi.arka6fx.com/_next/static/
sudo docker compose build --no-cache landing
sudo docker compose up -d --force-recreate landing nginx
```

Nginx 502 after deploy:

```bash
sudo docker compose restart nginx
```

Backend missing env:

```bash
sudo docker inspect yomi-backend-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sort
```

Do not print secret values into logs or chat.

## Security Notes

- Rotate any GitHub PAT that appears in shell output.
- Keep `.env.production` out of git.
- Keep the EC2 private key readable only by the owning user.
- Do not commit OAuth client secrets, Dodo secrets, or database URLs.
