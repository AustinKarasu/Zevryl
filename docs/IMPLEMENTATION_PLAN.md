# Zevryl Implementation Plan

## Current Build

- Expo React Native mobile app with Terra UI.
- Fastify backend connected to PostgreSQL and Redis.
- JWT auth with Argon2 password hashing.
- Friend requests, friends, groups, messages, announcements, admin stats, staff reports.
- LiveKit-ready call token endpoint for real voice/video in development and APK builds.

## Required Production Secrets

Set these in `.env` on the VPS:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

## Voice/Video

The app uses LiveKit. Official LiveKit docs require Expo development builds with:

- `@livekit/react-native`
- `@livekit/react-native-webrtc`
- `livekit-client`
- LiveKit Expo config plugin

Plain Expo Go is not enough for WebRTC calling.

## GitHub Release APK

The GitHub workflow builds Android APKs through EAS when a `v*` tag is pushed. Add `EXPO_TOKEN` in GitHub repository secrets before using it.
