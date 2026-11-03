# blackjack

A single-port web app

This app is the **garney-stack** default: one Node process serves the React client, REST APIs, and Socket.IO on a single port. Local development uses Docker Postgres, GoTrue (Supabase Auth), and PostgREST so you do not need a hosted Supabase project until you deploy.

## Run locally

```bash
npm install
npm run stack
npm run dev
```

- App: http://localhost:4121
- Auth / REST gateway: http://localhost:54321
- Inbucket (captured mail): http://localhost:9000
- Postgres: localhost:54322

Create an account with email and password. Local GoTrue autoconfirms email. Google SSO works after you set `GOOGLE_ENABLED=true` plus `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The signed-in home screen has private **notes** (REST, plus a socket event on your other tabs) and a shared **live chat** (Socket.IO `chat:message`). Open two browsers to see chat land without a refresh.

If signup against `http://localhost:54321/auth/v1/signup` returns **502**, Auth is not running. Check `docker compose logs auth`. A common cause was `auth.uid()` owned by `postgres`; this template creates those functions as `supabase_auth_admin`. Reset a broken local volume with `npm run db:reset`.

Stop the data plane:

```bash
npm run stack:down
```

Reset the local database:

```bash
npm run db:reset
```

Run the production image against the local stack:

```bash
npm run stack:app
```

## Production

Hosted Supabase Auth + Postgres. The local Docker services are not used in production.

```bash
npx garney-stack deploy
```

That command writes `deploy/production.env` (gitignored) and prints the Google OAuth and Render checklist. `render.yaml` is a Blueprint for a Docker web service. `VITE_*` values are compiled into the browser bundle at image build time.

## Layout

```text
client/          React + Vite
server/          Express, auth middleware, Socket.IO
shared/          Types shared by client and server
supabase/        SQL migrations (local Docker and hosted Supabase)
docker/          Postgres init, nginx gateway
```
