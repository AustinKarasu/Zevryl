# Zevryl

Premium mobile chat platform with secure accounts, friends, encrypted direct messages, groups, voice/video architecture, announcements, admin controls, staff tools, and VPS-ready backend services.

## Start

```powershell
npm install
npm run dev:api
npm run dev:mobile
```

## Structure

- `apps/mobile` - Expo React Native app
- `services/api` - Fastify API for auth, users, friends, groups, messages, announcements, moderation
- `infra` - Docker Compose for Postgres and Redis
- `docs` - product and deployment notes
