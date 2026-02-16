# Repository Guidelines

## Project Structure & Module Organization
HubRadar is an Android-first Expo app (React Native + TypeScript + NativeWind).
Current key paths:
- `App.tsx`: main screen, orchestration, settings modal, detail modal.
- `src/features/hub-search/services/amap.ts`: nearby hub discovery (subway/train/airport).
- `src/features/commute/services/amapDirection.ts`: active/transit/driving commute data.
- `src/features/location/services/amapInputTips.ts`: address suggestions.
- `src/features/location/services/amapRegeo.ts`: reverse geocoding and city context.
- `src/features/insight/services/scoring.ts`: accessibility scoring + smart hint.
- `src/features/history/services/queryHistory.ts`: local query history.
- `assets/`: app icons/splash images.

Keep feature logic inside `src/features/*`; avoid mixing API parsing logic into UI components.

## Build, Test, and Development Commands
Run from repo root:
- `npm install`: install dependencies.
- `npm run start -- --tunnel -c --port 8106`: start dev server for real device testing.
- `npm run android`: run on Android target.
- `npm run web`: run web preview.
- `npx tsc --noEmit`: type-check before PR.

If you add new tooling (lint/test), add matching scripts to `package.json`.

## Coding Style & Naming Conventions
- TypeScript only (`.ts` / `.tsx`), 2-space indentation.
- Components/types: `PascalCase`; helpers/hooks/functions: `camelCase`.
- Keep API response mapping explicit and defensive (null checks, parsing guards).
- Prefer small, focused service functions over large multi-purpose modules.
- Use NativeWind classes for UI; keep inline styles minimal.

## Testing Guidelines
- Baseline gate: `npx tsc --noEmit` must pass.
- Manual verification required for:
  - location permission flow,
  - custom address suggestions,
  - route results across active/transit/driving,
  - settings (planned departure + wheel picker),
  - detail modal expansion and history reuse.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Keep each commit scoped to one intent.
- PR should include:
  - behavior summary,
  - affected files/modules,
  - test evidence (commands + result),
  - Android screenshots for UI changes.

## Security & Configuration Tips
- Never hardcode API keys.
- Use `.env` with `EXPO_PUBLIC_*`; keep `.env` out of version control.
- Provide `.env.example` updates when adding new config keys.
- For production release, route sensitive map requests through a backend proxy.
