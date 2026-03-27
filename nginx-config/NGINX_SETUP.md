# Nginx Setup for AI Companion (Port 8080/8443)

This guide explains how to set up Nginx for the AI Companion application on ports 8080 (HTTP) and 8443 (HTTPS).

## Architecture

```
Browser → Nginx (Port 8443 HTTPS) → Node.js App (Port 3000)
```

## Why Different Ports?

Since Apache is already using ports 80/443 for another website, Nginx will use:
- **Port 8080** for HTTP (redirects to HTTPS)
- **Port 8443** for HTTPS

## Prerequisites

1. Nginx installed
2. Domain name: `companion.pastime.agency`
3. Ports 8080 and 8443 accessible

## Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx
```

## Step 2: Get SSL Certificate

If you don't already have one for this domain:

```bash
# Install Certbot for Nginx
sudo apt install certbot python3-certbot-nginx

# Get certificate (use standalone mode since Apache is using port 80)
sudo certbot certonly --standalone -d companion.pastime.agency
```

Or if Apache can temporarily proxy for certificate verification:

```bash
sudo certbot certonly --webroot -w /var/www/html -d companion.pastime.agency
```

The certificates will be at:
- `/etc/letsencrypt/live/companion.pastime.agency/fullchain.pem`
- `/etc/letsencrypt/live/companion.pastime.agency/privkey.pem`

## Step 3: Install Nginx Configuration

```bash
# Copy configuration
sudo cp /home/user/companion/nginx-config/companion.pastime.agency.conf /etc/nginx/sites-available/

# Create symlink to enable
sudo ln -s /etc/nginx/sites-available/companion.pastime.agency.conf /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## Step 4: Configure Node.js Application

Since Nginx handles SSL, configure Node.js to run on HTTP:

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

# Or use systemd (if configured)
sudo systemctl start companion
sudo systemctl enable companion
```

## Step 6: Configure Firewall

Open ports 8080 and 8443:

```bash
# UFW
sudo ufw allow 8080/tcp
sudo ufw allow 8443/tcp

# iptables
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8443 -j ACCEPT
```

## Step 7: Test

### Access the application:
```
https://companion.pastime.agency:8443
```

### Check services:
```bash
# Nginx status
sudo systemctl status nginx

# Node.js health check
curl http://localhost:3000/health

# Check Nginx logs
sudo tail -f /var/log/nginx/companion-access.log
sudo tail -f /var/log/nginx/companion-error.log
```

## Optional: DNS Configuration

If you want users to access without specifying the port, you have two options:

### Option A: Use a subdomain with SRV record
Not commonly used for HTTP/HTTPS.

### Option B: Apache reverse proxy to Nginx

Add this to your Apache configuration:

```apache
<VirtualHost *:443>
    ServerName companion.pastime.agency

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/companion.pastime.agency/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/companion.pastime.agency/privkey.pem

    # Proxy everything to Nginx
    ProxyPreserveHost On
    ProxyPass / https://localhost:8443/
    ProxyPassReverse / https://localhost:8443/

    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           wss://localhost:8443/$1 [P,L]

    SSLProxyEngine on
    SSLProxyVerify none
    SSLProxyCheckPeerCN off
    SSLProxyCheckPeerName off
</VirtualHost>
```

Then users can access via `https://companion.pastime.agency` (port 443).

## Troubleshooting

### Port already in use
```bash
# Check what's using port 8080 or 8443
sudo lsof -i :8080
sudo lsof -i :8443

# Kill if needed
sudo kill <PID>
```

### Nginx won't start
```bash
# Check configuration
sudo nginx -t

# Check error log
sudo tail -50 /var/log/nginx/error.log
```

### WebSocket not connecting
Verify the configuration includes:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Permission denied for SSL certificates
```bash
# Give Nginx access to certificates
sudo chmod 644 /etc/letsencrypt/live/companion.pastime.agency/fullchain.pem
sudo chmod 600 /etc/letsencrypt/live/companion.pastime.agency/privkey.pem
```

## SSL Certificate Renewal

Certbot will auto-renew. Test renewal:

```bash
sudo certbot renew --dry-run
```

After renewal, reload Nginx:
```bash
sudo systemctl reload nginx
```

## Security Notes

1. **Internal Port**: Node.js runs on localhost:3000 (not accessible externally)
2. **SSL Encryption**: All traffic encrypted via Nginx SSL
3. **WebSocket Secure**: Automatically uses WSS (WebSocket Secure)
4. **Non-standard ports**: Using 8080/8443 instead of 80/443

## Alternative: Testing without SSL

For testing purposes only, you can use HTTP without SSL:

```nginx
server {
    listen 8080;
    server_name companion.pastime.agency;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Access via: `http://companion.pastime.agency:8080`

**Warning**: Microphone access won't work remotely without HTTPS!
