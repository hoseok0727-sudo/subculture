# Subculture Game Hub (MVP)

Pickup/banner/update/maintenance notices for multiple subculture mobile games are unified into one feed.
Users can select their games and define alert rules. Admin can manage sources and run ingest/parsing flows.

## Implemented scope

- Auth: email signup/login (JWT)
- Public feed: `GET /api/events`, event detail, filters
- My feed: based on selected game regions
- User settings:
  - My game regions (`user_games`)
  - Notification rules (`notification_rules`)
  - Push subscription records
  - Planned schedules view
- Admin:
  - game/region/source CRUD (create endpoints)
  - manual source fetch
  - reparse raw notice
  - inspect raw notice errors / ingest runs
- Data pipeline:
  - raw notice ingest (RSS + HTML list)
  - parser/normalizer to `events`
  - confidence + visibility (`PUBLIC` / `NEED_REVIEW`)
  - schedule planning from rules
- Worker loop:
  - run due ingest
  - dispatch due notifications (simulated send + delivery logs)
- Frontend:
  - responsive UI for feed/my-feed/settings/admin
  - landing dashboard (`/`) with today stats + highlights
  - pickup snapshot visual page (`/pickup-snapshot`)
  - event detail quick rule actions
  - PWA basics (manifest + service worker registration)

## Project structure

- `api`: Express + PostgreSQL
- `web`: React + Vite (PWA shell)
- `worker`: periodic runner calling admin automation endpoints
- `docker-compose.yml`: postgres + redis + api + worker + web

## Environment variables

Use `.env.example` as baseline.

- `DB_URL`
- `REDIS_URL`
- `API_PORT`
- `VITE_API_BASE`
- `JWT_SECRET`
- `ADMIN_API_KEY`
- `DEFAULT_TIMEZONE`
- `WORKER_API_BASE`
- `WORKER_TICK_MS`

## Run (local)

1. Install

```bash
npm install
```

2. Start PostgreSQL + Redis (or use Docker if available)

3. Run migration + seed

```bash
npm run migrate
npm run seed
```

4. Start services (separate terminals)

```bash
npm run dev:api
npm run dev:web
npm run dev:worker
```

## Run (docker compose)

```bash
docker compose up --build
```

- Web: http://localhost:5173
- API: http://localhost:4000

## Seed accounts

- Admin: `admin@subculture.local` / `admin1234`
- Demo user: `demo@subculture.local` / `demo1234`

## Useful APIs

- Public
  - `GET /api/games`
  - `GET /api/events`
  - `GET /api/events/:id`
  - `GET /api/pickup-snapshot/latest`
- Auth
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
- Me
  - `GET /api/me`
  - `GET/POST/DELETE /api/me/games`
  - `GET/POST/PATCH/DELETE /api/me/notification-rules`
  - `GET /api/me/feed`
  - `GET /api/me/notification-schedules`
- Admin
  - `POST /api/admin/games`
  - `POST /api/admin/regions`
  - `GET/POST /api/admin/sources`
  - `POST /api/admin/sources/:id/run-fetch`
  - `GET /api/admin/raw-notices?status=ERROR`
  - `POST /api/admin/raw-notices/:id/reparse`
  - `POST /api/admin/ingest/run-due`
  - `POST /api/admin/notifications/dispatch-due`

## Validation done

- `npm --workspace api run build`
- `npm --workspace web run build`
- `npm --workspace worker run build`
- `npm --workspace api run test`

## Pickup snapshot quick test

1. Generate latest snapshot data

```bash
npm --workspace api run pickups:test
```

2. Run API + web

```bash
npm run dev:api
npm run dev:web
```

3. Open pages

- Home dashboard: `http://localhost:5173/`
- Pickup snapshot: `http://localhost:5173/pickup-snapshot`

> Images in snapshot are loaded from official notice pages by URL.
> Copyright remains with each publisher.
