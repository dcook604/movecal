#!/bin/sh
set -e

if [ -z "${DATABASE_URL}" ]; then
  echo "DATABASE_URL is not set"
  exit 1
fi

echo "Running migrations..."
npx prisma migrate deploy --schema backend/prisma/schema.prisma

echo "Starting server..."
node backend/dist/server.js
