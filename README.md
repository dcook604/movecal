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
- FRONTEND_URL
- UPLOADS_DIR

## Test
```bash
npm test
```

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
