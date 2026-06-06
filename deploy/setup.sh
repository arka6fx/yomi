#!/bin/bash
set -e

echo "=== Yomi EC2 Setup Script ==="

# Update system
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker
echo "Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
rm get-docker.sh

# Add current user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
echo "Installing Docker Compose..."
sudo apt install -y docker-compose-plugin

# Install Certbot
echo "Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# Configure UFW firewall
echo "Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Create directories
echo "Creating deployment directories..."
sudo mkdir -p /opt/yomi/deploy/{certs,logs}
sudo chown -R $USER:$USER /opt/yomi

# Create certbot webroot
sudo mkdir -p /var/www/certbot
sudo chown -R $USER:$USER /var/www/certbot

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Clone your repo: git clone https://github.com/arka6fx/yomi.git /opt/yomi"
echo "2. Create .env.production from .env.example"
echo "3. Run: docker compose up -d --build"
echo "4. Get SSL certificate: sudo certbot --nginx -d yomi.arka6fx.com"
echo ""
echo "Note: You may need to log out and back in for docker group to take effect."
