# Docker

Optional Docker configuration for monitoring Docker containers via the web interface.

## Setup

Place your `docker-compose.yml` here if you want Docker monitoring feature to work:

```yaml
version: '3.8'
services:
  your-services:
    # your containers...
```

The backend will detect and monitor these containers through Dockerode.