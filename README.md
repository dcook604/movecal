# MoveCal - Strata Move Booking System

Production-ready starter for Strata Move-In/Move-Out + Elevator Booking.

## Stack
- Backend: Fastify + TypeScript + Prisma + PostgreSQL
- Frontend: React + Vite
- Auth: JWT + bcrypt
- Email: Nodemailer SMTP with encrypted password-at-rest

## Setup
1. Install deps:
   ```bash
   npm install
   ```
2. Configure env:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
3. Run Postgres and set `DATABASE_URL` (example):
   ```
   postgresql://postgres:postgres@localhost:5432/movecal
   ```
4. Run migrations + generate client:
   ```bash
   npm run prisma:generate -w backend
   npm run prisma:migrate -w backend
   ```
5. Seed users:
   ```bash
   npx tsx backend/src/seed.ts
   ```
6. Start apps:
   ```bash
   npm run dev
   ```

## Env vars (backend)
- DATABASE_URL
- PORT
- JWT_SECRET
- SETTINGS_ENCRYPTION_KEY
- INTAKE_SHARED_SECRET
- FRONTEND_URL (comma-separated list of allowed origins)
- UPLOADS_DIR
- NODE_ENV (set to `production` in Coolify)

## Env vars (frontend)
- VITE_API_URL (backend base URL, required for production build)

## Test
```bash
npm test
```

## Coolify deployment checklist
- This Dockerfile builds a single image that serves backend APIs and the frontend SPA.
- Frontend is served from the backend container at the same domain.
- Set `NODE_ENV=production` for backend service.
- Backend env vars required in production:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `SETTINGS_ENCRYPTION_KEY` (32+ chars)
  - `INTAKE_SHARED_SECRET`
  - `FRONTEND_URL` (comma-separated allowed origins)
  - `UPLOADS_DIR`
- Frontend env vars:
  - `VITE_API_URL` (public URL of backend, same domain)
  - Ensure `VITE_API_URL` is provided as a build arg in Coolify so Vite sees it at build time.
- Run Prisma migrations during deploy:
  - `npm run prisma:generate -w backend`
  - `npm run prisma:migrate -w backend`
- Seed initial users (once):
  - `npx tsx backend/src/seed.ts`
- Ensure uploads storage is persisted/mounted for `UPLOADS_DIR`.
- Health check path: `GET /health` on backend.

## Key features implemented
- Public approved-bookings calendar endpoint
- Resident submission + confirmation email
- Admin booking management + approval + conflict override by Council/Property Manager
- 60-minute elevator conflict/buffer checks at submission and approval
- SMTP settings in DB with encrypted password
- Notification recipients configurable by event
- Audit logging for approvals, settings, recipients, and overrides
- Email webhook intake endpoint with shared secret
- CSV export + dashboard stats API
