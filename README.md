# Media Vault - Media Server

A self-hosted media server with WhatsApp integration and monitoring capabilities.

## 📋 Project Overview

| Component | Description | Port |
|-----------|-------------|------|
| **Backend** | Express.js API server with media management | 3001 |
| **Frontend** | React + Vite web interface | - |
| **WhatsApp Bot** | WhatsApp Web automation | - |
| **Docker** | WhatsApp HTTP API (waha) + Nginx proxy | 3002, 4000 |
| **Monitoring** | Real-time system metrics dashboard | - |

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/NE2KO/Neko2Neko.git
cd homelab-media-server
```

### 2. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env and fill in your values
nano .env
```

### 3. Install Dependencies

```bash
# Install all packages
npm install
cd backend && npm install
cd ../frontend && npm install
cd ../whatsapp-bot && npm install
```

### 4. Generate SSL Certificates (Optional)

```bash
# See certs/README.md for details
openssl req -x509 -newkey rsa:2048 \
  -keyout backend/certs/key.pem \
  -out backend/certs/cert.pem \
  -days 3650 -nodes -subj "/CN=localhost"

# Copy to frontend
cp backend/certs/cert.pem frontend/certs/localhost.pem
cp backend/certs/key.pem frontend/certs/localhost-key.pem
```

### 5. Start the Server

```bash
# Start backend
npm run dev

# Or with PM2 for production
pm2 start backend/src/server.js
```

### 6. Access the Web Interface

Open `http://localhost:3001` in your browser.

## 🐳 Docker Setup

For WhatsApp HTTP API and Nginx proxy:

```bash
# Copy environment variables
cp .env.example .env

# Set required values
export NVIDIA_API_KEY=your_api_key
export LITELLM_MASTER_KEY=your_master_key

# Start services
docker-compose up -d
```

| Service | Port | Description |
|---------|------|-------------|
| waha | 3002 | WhatsApp HTTP API |
| nginx-nvidia | 4000 | Reverse proxy for NVIDIA API |

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | No |
| `TELEGRAM_CHAT_ID` | Telegram group chat ID | No |
| `TARGET_CHAT_JID` | WhatsApp target chat | No |
| `PORT` | Backend server port | No (default: 3001) |
| `MEDIA_ROOT` | Media storage path | No |
| `TLS_KEY` | SSL private key path | No |
| `TLS_CERT` | SSL certificate path | No |

### Credentials Folder

Sensitive files are stored in `credentials/`:

```
credentials/
├── .env                    # Telegram bot token, API keys
├── cookies.txt             # WhatsApp Web session cookies
├── gtw.txt                 # WhatsApp chat logs
├── .wwebjs_auth/           # WhatsApp authentication
└── docs-debug/             # Debug documentation
```

> **Note:** The `credentials/` folder is gitignored for security.

## 📁 Project Structure

```
homelab-media-server/
├── backend/                  # Express.js server
│   ├── src/                  # Server code
│   ├── certs/                # SSL certificates
│   └── package.json
├── frontend/                 # React web app
│   ├── src/
│   └── package.json
├── whatsapp-bot/             # WhatsApp automation
│   └── src/
├── Docker/                   # Docker configurations
│   ├── docker-compose.yml
│   ├── litellm-config.yaml
│   └── nginx-nvidia/
├── credentials/              # Sensitive files (gitignored)
├── docs/                     # Documentation (gitignored)
├── certs/                    # Certificate generation scripts
├── .env.example              # Environment template
├── ARCHITECTURE.md           # Detailed architecture docs
└── package.json              # Root package.json
```

## 🔧 Development

### Available Scripts

```bash
# Root
npm run dev          # Start all services
npm run build        # Build frontend
npm run lint         # Run linter

# Backend
cd backend && npm run dev
cd backend && npm run test

# Frontend
cd frontend && npm run dev
cd frontend && npm run build
```

### Monitoring

The backend includes a monitoring dashboard at `/monitoring`.

## 🛡️ Security Notes

- **Never commit `.env` files** - they contain secrets
- **Never commit private keys** in `backend/certs/` and `frontend/certs/`
- **Never commit WhatsApp session data** - it's in `credentials/`
- All sensitive files are listed in `.gitignore`

## 📚 Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed system architecture
- [Docker/README.md](Docker/README.md) - Docker setup guide
- [certs/README.md](certs/README.md) - SSL certificate generation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Push to your fork
5. Create a Pull Request

## 📄 License

This project is open source. See LICENSE file for details.