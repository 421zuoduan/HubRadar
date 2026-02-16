# Repository Guidelines

## Project Structure & Module Organization
This repository hosts **HubRadar**, an Android-focused Expo app (React Native + TypeScript + NativeWind).
Use this layout after initialization:
- `app/`: Expo Router screens (entry routes such as `index.tsx`, `dashboard.tsx`).
- `src/components/`: reusable UI components.
- `src/features/`: domain modules (`location`, `hub-search`, `commute`).
- `src/config/`: environment/config loaders.
- `src/platform/android/`: Android-specific logic (e.g., `BackHandler`).
- `assets/`: icons, images, fonts.
- `__tests__/` or `src/**/__tests__/`: unit/integration tests.

Keep feature logic close to its module; avoid cross-feature imports except through typed service interfaces.

## Build, Test, and Development Commands
Run from repository root:
- `npm install`: install dependencies.
- `npx expo start --tunnel`: start dev server for real-device testing (recommended).
- `npx expo start --android`: launch on Android emulator/device if available.
- `npm run lint`: run lint checks.
- `npm test`: run test suite.
- `npx eas build -p android --profile preview`: generate installable Android preview build.

If scripts are missing, add them to `package.json` before opening a PR.

## Coding Style & Naming Conventions
- Language: TypeScript (`.ts`/`.tsx`), 2-space indentation.
- Components: `PascalCase` filenames (e.g., `CommuteCard.tsx`).
- Hooks/utilities: `camelCase` (e.g., `useCurrentLocation.ts`).
- Prefer functional components and explicit return types for exported APIs.
- Use NativeWind class utilities for styling; keep inline style objects minimal.
- Enforce style with ESLint + Prettier.

## Testing Guidelines
- Preferred stack: Jest + React Native Testing Library.
- Test files: `*.test.ts` / `*.test.tsx`.
- Cover core flows: location permission, nearest hub lookup, commute ranking fallback (`transit` -> `driving`).
- Add regression tests for bug fixes.

## Commit & Pull Request Guidelines
- Follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- Keep commits small and scoped to one concern.
- PRs must include:
  - purpose and summary of changes,
  - linked issue/task,
  - test evidence (command output),
  - screenshots/video for UI changes on Android.

## Security & Configuration Tips
- Do not hardcode API keys.
- Store client-safe values in `.env` via `EXPO_PUBLIC_*`.
- Route sensitive map API calls through a backend proxy before production release.
