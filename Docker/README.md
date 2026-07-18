# Docker Configuration

This folder contains Docker configuration files for setting up the media server infrastructure.

## Files

- `docker-compose.yml` - Docker Compose configuration
- `litellm-config.yaml` - LiteLLM router configuration
- `nginx-nvidia/nginx.conf` - Nginx reverse proxy configuration
- `waha-data/` - WhatsApp session data (gitignored)

## Quick Start

1. Copy environment files:
   ```bash
   cp .env.example .env
   ```

2. Set required environment variables in `.env`:
   ```bash
   NVIDIA_API_KEY=your_api_key_here
   LITELLM_MASTER_KEY=your_master_key_here
   ```

3. Start services:
   ```bash
   docker-compose up -d
   ```

## Services

### waha (WhatsApp HTTP API)
- Port: 3002
- Used by: Backend WhatsApp integration
- Session storage: `./waha-data/`

### nginx-nvidia (Reverse Proxy)
- Port: 4000
- Proxies to: NVIDIA API
- Rate limited: 39 requests/minute per IP

## Configuration

All configurations use environment variables with fallback defaults.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NVIDIA_API_BASE` | NVIDIA API URL | `https://integrate.api.nvidia.com` |
| `NVIDIA_API_KEY` | NVIDIA API Key | (required) |
| `LITELLM_MASTER_KEY` | LiteLLM master key | `sk-litellm` |
| `API_BASE_URL` | Proxy target URL | (from config) |
| `API_HOST` | Proxy target host | (from config) |