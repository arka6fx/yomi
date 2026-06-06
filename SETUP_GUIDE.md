# Yomi Deployment & Setup Guide

## ✅ Completed Steps

1. ✅ EC2 instance launched (c7i-flex.large, ap-south-1 Mumbai)
2. ✅ Elastic IP allocated and associated
3. ✅ SSH key pair downloaded
4. ✅ DNS A record added (yomi.arka6fx.com → Elastic IP)
5. ✅ Google OAuth URLs updated
6. ✅ GitHub OAuth URLs updated
7. ✅ GitHub Actions secrets added (EC2_HOST, EC2_SSH_KEY)
8. ✅ All deployment files created (Docker, nginx, CI/CD)

---

## 🚀 Next Steps: Manual Setup

### Step 1: SSH into EC2 Instance

```bash
# From your local machine
ssh -i yomi-ec2-key.pem ubuntu@<your-elastic-ip>
```

**Example:**
```bash
ssh -i yomi-ec2-key.pem ubuntu@13.234.56.78
```

### Step 2: Run Setup Script

```bash
# Once logged into EC2
cd /opt/yomi
git clone https://github.com/arka6fx/yomi.git .
chmod +x deploy/setup.sh
./deploy/setup.sh
```

This will:
- Install Docker & Docker Compose
- Configure UFW firewall (ports 22, 80, 443)
- Install Certbot for SSL
- Create deployment directories

### Step 3: Configure Production Environment

```bash
# Generate encryption key
openssl rand -hex 32

# Copy and edit production env
cp .env.example .env.production
nano .env.production
```

**Update these values in `.env.production`:**
```bash
ENCRYPTION_KEY=<paste-the-hex-key-you-generated>

# Verify these match your OAuth setup
GOOGLE_CLIENT_ID=309890578090-...
GOOGLE_CLIENT_SECRET=GOCSPX-...
GITHUB_CLIENT_ID=Ov23lijL89pMm38klD0y
GITHUB_CLIENT_SECRET=f80244c7069e02e1d776e1bfb2825862d3fb3825

# All URLs should point to your production domain
BETTER_AUTH_URL=https://yomi.arka6fx.com
BETTER_AUTH_BASE_URL=https://yomi.arka6fx.com
BACKEND_URL=https://yomi.arka6fx.com
NEXT_PUBLIC_BACKEND_URL=https://yomi.arka6fx.com
NEXT_PUBLIC_APP_URL=https://yomi.arka6fx.com
CORS_ORIGIN=https://yomi.arka6fx.com
```

### Step 4: Build and Start Services

```bash
# Build Docker images
docker compose build

# Start all services
docker compose up -d

# Check status
docker compose ps
```

### Step 5: Setup SSL Certificate

```bash
# Stop nginx temporarily (certbot needs port 80)
docker compose stop nginx

# Get SSL certificate
sudo certbot certonly --standalone -d yomi.arka6fx.com

# Restart nginx
docker compose start nginx
```

**Auto-renewal is already configured** via certbot's systemd timer.

### Step 6: Verify Deployment

```bash
# Test health endpoints
curl https://yomi.arka6fx.com/health
curl https://yomi.arka6fx.com/api/health

# Check logs
docker compose logs -f backend
docker compose logs -f landing
```

---

## 📦 GitHub Releases Setup (Desktop App Distribution)

### Step 1: Create a Release Tag

```bash
# From your local machine (not EC2)
cd /path/to/yomi

# Create and push a version tag
git tag v0.1.0
git push origin v0.1.0
```

### Step 2: Build Windows Installer

```bash
# Navigate to desktop app
cd apps/desktop

# Install dependencies (if not already done)
bun install

# Build the installer
bun run dist:win
```

This creates: `apps/desktop/release/Yomi-0.1.0-x64.exe`

### Step 3: Upload to GitHub Release

**Option A: Manual Upload (Recommended for first release)**

1. Go to: https://github.com/arka6fx/yomi/releases
2. Click "Draft a new release"
3. Choose tag: `v0.1.0`
4. Release title: `Yomi v0.1.0 - Initial Release`
5. Write release notes (features, changes, etc.)
6. Drag & drop `apps/desktop/release/Yomi-0.1.0-x64.exe` into the assets area
7. Click "Publish release"

**Option B: Automated Upload (For future releases)**

```bash
# Install GitHub CLI (if not installed)
# Windows: winget install GitHub.cli
# Mac: brew install gh

# Login to GitHub
gh auth login

# Upload the installer
cd apps/desktop
gh release upload v0.1.0 release/Yomi-0.1.0-x64.exe --clobber
```

### Step 4: Verify Download Page

Visit: https://yomi.arka6fx.com/download

You should see:
- Version number (v0.1.0)
- Release date
- File size
- Download button
- Release notes
- SmartScreen warning explanation

---

## 🔧 Useful Commands

### EC2 Management

```bash
# SSH into server
ssh -i yomi-ec2-key.pem ubuntu@<elastic-ip>

# View logs
docker compose logs -f backend
docker compose logs -f landing
docker compose logs -f nginx

# Restart services
docker compose restart

# Stop all services
docker compose down

# Start all services
docker compose up -d

# Rebuild after code changes
git pull origin main
docker compose build --no-cache
docker compose up -d

# Check resource usage
docker stats
```

### SSL Certificate Management

```bash
# Test renewal (dry run)
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal

# View certificate info
sudo certbot certificates
```

### Database Management

```bash
# Run migrations (from EC2)
cd /opt/yomi
docker compose exec backend bunx drizzle-kit migrate

# Or from your local machine
cd packages/db
DATABASE_URL=<your-neon-url> bunx drizzle-kit migrate
```

---

## 🐛 Troubleshooting

### Docker Build Fails

```bash
# Clear Docker cache
docker system prune -a

# Rebuild without cache
docker compose build --no-cache
```

### Nginx Won't Start

```bash
# Check if port 80/443 is in use
sudo lsof -i :80
sudo lsof -i :443

# Check nginx config syntax
docker compose exec nginx nginx -t

# View nginx error logs
docker compose logs nginx
tail -f deploy/logs/error.log
```

### SSL Certificate Issues

```bash
# Check certificate status
sudo certbot certificates

# Manually renew
sudo certbot renew --force-renewal

# Reinstall certificate
sudo certbot --nginx -d yomi.arka6fx.com --force-renewal
```

### Backend Not Responding

```bash
# Check backend logs
docker compose logs backend

# Restart backend
docker compose restart backend

# Check if backend is healthy
curl http://localhost:3001/health
```

### Landing Page Not Loading

```bash
# Check landing logs
docker compose logs landing

# Verify standalone build exists
docker compose exec landing ls -la .next/standalone

# Restart landing
docker compose restart landing
```

---

## 📊 Monitoring

### View Real-time Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f landing
docker compose logs -f nginx
```

### Check Service Health

```bash
# Docker health checks
docker compose ps

# Manual health checks
curl https://yomi.arka6fx.com/health
curl https://yomi.arka6fx.com/api/health
```

### Resource Usage

```bash
# Docker container stats
docker stats

# System resources
htop
df -h
free -m
```

---

## 🔄 Deployment Workflow

### Local Development → Production

1. **Make changes locally**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   git push origin main
   ```

2. **Auto-deploy triggers** (GitHub Actions)
   - Builds and tests code
   - SSHs into EC2
   - Pulls latest code
   - Rebuilds Docker images
   - Restarts services

3. **Verify deployment**
   ```bash
   curl https://yomi.arka6fx.com/health
   ```

### Manual Deployment (if needed)

```bash
# SSH into EC2
ssh -i yomi-ec2-key.pem ubuntu@<elastic-ip>

# Pull latest code
cd /opt/yomi
git pull origin main

# Rebuild and restart
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## 🔐 Security Checklist

- [x] SSH key secured (chmod 400)
- [x] UFW firewall configured (only 22, 80, 443 open)
- [x] SSL certificate installed
- [x] `.env.production` not committed to git
- [x] Database URL uses SSL (`sslmode=require`)
- [x] OAuth secrets stored in `.env.production`
- [x] GitHub Actions secrets configured
- [ ] Code signing certificate (deferred for beta)
- [ ] Rate limiting configured (nginx has basic limits)
- [ ] Regular backups (Neon handles DB backups)

---

## 📝 Environment Variables Reference

### Production (.env.production)

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Neon Postgres connection | `postgresql://...` |
| `BETTER_AUTH_SECRET` | Auth encryption key | `Ss57I108tuAfstRkLRnL/...` |
| `BETTER_AUTH_URL` | Public auth URL | `https://yomi.arka6fx.com` |
| `GOOGLE_CLIENT_ID` | Google OAuth | `309890578090-...` |
| `GITHUB_CLIENT_ID` | GitHub OAuth | `Ov23lijL89pMm38klD0y` |
| `ENCRYPTION_KEY` | OAuth token encryption | `openssl rand -hex 32` |
| `OPENAI_API_KEY` | AI Credits API | `sk-live-...` |
| `ELEVENLABS_API_KEY` | Speech services | `sk_...` |
| `CORS_ORIGIN` | Allowed CORS origin | `https://yomi.arka6fx.com` |

### Local Development (.env)

Same variables but with `http://localhost:3000` and `http://localhost:3001` URLs.

---

## 🎯 Post-Deployment Tasks

### Immediate

1. ✅ Test health endpoints
2. ✅ Test OAuth login (Google + GitHub)
3. ✅ Create first user account
4. ✅ Verify landing page loads
5. ⏳ Upload first desktop release to GitHub
6. ⏳ Test download page

### Within 24 Hours

1. Monitor logs for errors
2. Check SSL certificate auto-renewal
3. Test device-code auth flow
4. Verify desktop app connects to production backend

### Within 1 Week

1. Set up monitoring (Uptime Kuma, Grafana)
2. Configure automated backups
3. Test Razorpay billing (when ready)
4. Set up error tracking (Sentry, etc.)

---

## 📞 Support

### Documentation

- [Docker Compose](https://docs.docker.com/compose/)
- [Nginx](https://nginx.org/en/docs/)
- [Let's Encrypt](https://letsencrypt.org/docs/)
- [GitHub Actions](https://docs.github.com/en/actions)

### Logs Location

- Nginx: `/opt/yomi/deploy/logs/`
- Docker: `docker compose logs <service>`
- System: `/var/log/syslog`

---

## 🎉 You're Done!

Your Yomi deployment is now live at:
- **Landing Page:** https://yomi.arka6fx.com
- **API:** https://yomi.arka6fx.com/api
- **Download:** https://yomi.arka6fx.com/download

Next: Upload your first desktop release to GitHub and test the full flow!
