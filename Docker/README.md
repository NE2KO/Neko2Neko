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

3. Customize nginx (optional):
   Edit `nginx-nvidia/nginx.conf` to change the target API URL or other settings.

4. Start services:
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
- Proxies to: Target API (default: NVIDIA)
- Rate limited: 39 requests/minute per IP

## Customization

### Nginx Configuration

Edit `nginx-nvidia/nginx.conf` to customize:
- `proxy_pass` - Target API URL
- `proxy_set_header Host` - Target host
- `limit_req_zone` - Rate limiting settings

### LiteLLM Configuration

Edit `litellm-config.yaml` to customize:
- `master_key` - LiteLLM master key (use env var: `LITELLM_MASTER_KEY`)
- `api_base` - Target API URL (use env var: `NVIDIA_API_BASE`)
- `api_key` - API key (use env var: `NVIDIA_API_KEY`)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NVIDIA_API_KEY` | API key for NVIDIA/LLM services | Yes |
| `LITELLM_MASTER_KEY` | Master key for LiteLLM router | No (default: sk-litellm) |
| `NVIDIA_API_BASE` | Base URL for API | No (default: https://integrate.api.nvidia.com) |