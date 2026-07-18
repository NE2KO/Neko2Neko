# Credentials Folder

This folder contains sensitive files that should not be committed to version control.

## Contents

- `.env` - Environment variables (Telegram bot token, API keys, etc.)
- `cookies.txt` - Browser cookies for WhatsApp Web authentication
- `cookies.txt.bak` - Backup of cookies
- `gtw.txt` - WhatsApp chat logs
- `.wwebjs_auth/` - WhatsApp Web authentication data
- `.wwebjs_cache/` - WhatsApp Web cache
- `docs-debug/` - Debug documentation (chat IDs, etc.)

## Setup

Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

## Git Status

This folder is in `.gitignore` and will not be tracked by git.

## Moving Files

If you need to move files here from other locations:
```bash
mv cookies.txt credentials/
mv gtw.txt credentials/
mv .env credentials/
mv .wwebjs_auth/ credentials/
mv .wwebjs_cache/ credentials/
```