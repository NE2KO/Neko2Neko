# SSL/TLS Certificates

This folder contains placeholder files. Generate your own certificates for development.

## Generate with OpenSSL

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/CN=localhost"

# Move to appropriate folders
mv cert.pem backend/certs/
mv key.pem backend/certs/
mv key.pem frontend/certs/localhost-key.pem
mv cert.pem frontend/certs/localhost.pem
```

## Generate with mkcert

```bash
# Install mkcert first
mkcert -install
mkcert localhost 127.0.0.1 ::1

# Move files
mv localhost+2.pem backend/certs/cert.pem
mv localhost+2-key.pem backend/certs/key.pem
```

## Security Note

**Never commit real private keys to version control.**
These certificates are for local development only.
