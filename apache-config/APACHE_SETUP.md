# Apache Reverse Proxy Setup for AI Companion

This guide explains how to set up Apache as a reverse proxy for the AI Companion Node.js application.

## Architecture

```
Browser (HTTPS) → Apache (Port 443) → Node.js App (Port 3000)
```

Apache handles:
- SSL/TLS encryption (HTTPS)
- WebSocket upgrade for real-time audio
- Reverse proxy to Node.js application

## Prerequisites

1. Apache2 installed
2. Domain name pointing to your server (companion.pastime.agency)
3. Port 80 and 443 accessible

## Step 1: Enable Required Apache Modules

```bash
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod proxy_wstunnel
sudo a2enmod ssl
sudo a2enmod rewrite
sudo a2enmod headers
```

## Step 2: Install SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt update
sudo apt install certbot python3-certbot-apache

# Get SSL certificate
sudo certbot certonly --apache -d companion.pastime.agency
```

The certificates will be installed at:
- `/etc/letsencrypt/live/companion.pastime.agency/fullchain.pem`
- `/etc/letsencrypt/live/companion.pastime.agency/privkey.pem`

## Step 3: Install Apache Configuration

```bash
# Copy the configuration file
sudo cp /home/user/companion/apache-config/companion.pastime.agency.conf /etc/apache2/sites-available/

# Enable the site
sudo a2ensite companion.pastime.agency.conf

# Test configuration
sudo apache2ctl configtest

# Reload Apache
sudo systemctl reload apache2
```

## Step 4: Configure Node.js Application

Since Apache handles SSL, configure the Node.js app to run on HTTP:

Edit `/opt/companion/.env`:
```bash
USE_HTTPS=false
PORT=3000
```

## Step 5: Start Node.js Application

```bash
cd /opt/companion

# Start the application
npm start

# Or use systemd service (if configured)
sudo systemctl start companion
sudo systemctl enable companion
```

## Step 6: Test

1. Open browser: `https://companion.pastime.agency`
2. You should see the AI Companion interface
3. Click "Start Session" - should connect via WebSocket
4. Click "Push to talk" - microphone should work (will ask for permission)

## Troubleshooting

### Check Apache is running
```bash
sudo systemctl status apache2
```

### Check Node.js app is running
```bash
curl http://localhost:3000/health
# Should return: {"status":"healthy",...}
```

### Check Apache logs
```bash
sudo tail -f /var/log/apache2/companion-error.log
sudo tail -f /var/log/apache2/companion-access.log
```

### WebSocket not connecting
Check that `mod_proxy_wstunnel` is enabled:
```bash
sudo apache2ctl -M | grep proxy_wstunnel
```

### Port 3000 already in use
```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process if needed
sudo kill <PID>
```

## Firewall Configuration

Make sure ports 80 and 443 are open:

```bash
# UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# iptables
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

## SSL Certificate Auto-Renewal

Certbot installs a cron job automatically. Test renewal:

```bash
sudo certbot renew --dry-run
```

## Security Notes

1. **Internal Port**: The Node.js app runs on port 3000 (localhost only)
2. **No Direct Access**: Users cannot access port 3000 directly
3. **SSL Required**: All traffic encrypted via Apache SSL
4. **WebSocket Secure**: Automatically upgraded to WSS (WebSocket Secure)

## Alternative: If SSL certificate is not yet set up

If you don't have the SSL certificate yet, you can temporarily use HTTP only for testing:

```apache
<VirtualHost *:80>
    ServerName companion.pastime.agency

    ProxyPreserveHost On
    ProxyRequests Off

    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           ws://localhost:3000/$1 [P,L]
    RewriteCond %{HTTP:Upgrade} !=websocket [NC]
    RewriteRule /(.*)           http://localhost:3000/$1 [P,L]
</VirtualHost>
```

**Note**: Microphone access will only work from `localhost` with HTTP. For remote access, HTTPS is required.
