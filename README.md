# PadHop

**AI-powered helicopter charter & helipad booking platform for India** — an Uber/Ola-style on-demand and advance-reservation system, built around a real-time nearest-helipad matching engine.

## The idea

Helicopter charter demand exists in India today — weddings, pilgrimage routes (Char Dham, Kedarnath), corporate travel — but the booking experience is still phone calls and spreadsheets. PadHop applies the on-demand matching model (think Uber's "Now" and "Reserve" modes) to real, fixed helipads: search nearby availability, book instantly or in advance, track the flight live once airborne.

This is a personal portfolio project, built to a real production standard — proper architecture, testing, CI/CD, and documentation — not a tutorial clone.

## Status

🚧 **Phase 1: Matching Engine Core** — in progress

- [x] Monorepo scaffold (Turborepo)
- [x] Local infrastructure (Docker Compose: PostgreSQL + PostGIS, Redis)
- [x] Data model (Prisma schema, 7 core tables)
- [x] Nearest-helipad geospatial search API (`GET /helipads/nearest`)
- [ ] Availability state machine + Redis hold/lock mechanism
- [ ] Auth, booking flow, web/mobile frontends, AI pricing, payments — see [roadmap](./docs/roadmap.md)

## Tech stack

| Layer           | Choice                               |
| --------------- | ------------------------------------ |
| Web             | React + TypeScript, Next.js          |
| Mobile          | React Native (Expo) — planned        |
| API             | NestJS (TypeScript)                  |
| Database        | PostgreSQL + PostGIS, via Prisma ORM |
| Cache / locking | Redis                                |
| AI service      | Python FastAPI — planned             |
| Infra (local)   | Docker Compose                       |

## Architecture

Three-tier: client apps → backend platform (NestJS API + AI service) → data layer (Postgres+PostGIS, Redis). Full system diagram and ERD in [`docs/architecture/`](./docs/architecture).

The core technical piece is the **nearest-helipad matching engine** — PostGIS geospatial queries (`ST_DWithin`, `ST_Distance`) power both "Now" (instant) and "Reserve" (scheduled) booking modes against a shared `AvailabilitySlot` state machine.

## Running locally

**Prerequisites:** Node.js 22+, Docker Desktop, npm

```bash
# 1. Clone and install
git clone https://github.com/kishan1801/padhop.git
cd padhop
npm install

# 2. Start local infrastructure (Postgres + PostGIS, Redis)
docker compose up -d

# 3. Set up the API
cd apps/api
cp .env.example .env   # then fill in DATABASE_URL — see below
npx prisma generate
npx prisma migrate dev
npx prisma db seed

# 4. Run the API
npm run start:dev
```

API runs at `http://localhost:3000`. Try the matching engine:

```bash
curl "http://localhost:3000/helipads/nearest?lat=12.9716&lng=77.5946&radiusKm=50"
```

## Project structure
