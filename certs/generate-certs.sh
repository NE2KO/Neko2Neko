#!/bin/bash
# Generate SSL certificates for local development

set -e

echo "Generating SSL certificates for local development..."

# Create directories if not exist
mkdir -p backend/certs frontend/certs

# Generate self-signed certificate for backend
openssl req -x509 -newkey rsa:2048 \
  -keyout backend/certs/key.pem \
  -out backend/certs/cert.pem \
  -days 3650 \
  -nodes \
  -subj "/CN=homelab-local" 2>/dev/null

# Copy for frontend
cp backend/certs/cert.pem frontend/certs/localhost.pem
cp backend/certs/key.pem frontend/certs/localhost-key.pem

echo "Certificates generated successfully!"
echo "  backend/certs/cert.pem"
echo "  backend/certs/key.pem"
echo "  frontend/certs/localhost.pem"
echo "  frontend/certs/localhost-key.pem"
