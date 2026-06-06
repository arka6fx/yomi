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
sudo apt install -y certbot

# Configure UFW firewall
echo "Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Create directories
echo "Creating deployment directories..."
sudo mkdir -p /opt/yomi/deploy/{certs,certbot-work,logs}
sudo chown -R $USER:$USER /opt/yomi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Clone your repo: git clone https://github.com/arka6fx/yomi.git /opt/yomi"
echo "2. Create .env.production from .env.example"
echo "3. Issue SSL certificate using the command in SETUP_GUIDE.md"
echo "4. Run: docker compose --env-file .env.production up -d --build"
echo ""
echo "Note: You may need to log out and back in for docker group to take effect."
