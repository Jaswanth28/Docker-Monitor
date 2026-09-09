#!/usr/bin/env bash
# Generates a .env from .env.example with random Infisical bootstrap values.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env already exists, refusing to overwrite"; exit 1; }
cp .env.example .env
sed -i "s|^INFISICAL_ENCRYPTION_KEY=.*|INFISICAL_ENCRYPTION_KEY=$(openssl rand -hex 16)|" .env
sed -i "s|^INFISICAL_AUTH_SECRET=.*|INFISICAL_AUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')|" .env
sed -i "s|^INFISICAL_DB_PASSWORD=.*|INFISICAL_DB_PASSWORD=$(openssl rand -hex 16)|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^STACKS_DIR=.*|STACKS_DIR=$(pwd)/stacks|" .env
echo "Wrote .env (STACKS_DIR=$(pwd)/stacks). Now set ADMIN_PASSWORD_HASH / VIEWER_PASSWORD_HASH."
