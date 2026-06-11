# AGENTS.md — `@sstreichan/opencode-tps`

## Project Overview

OpenCode TUI plugin that displays a live tokens-per-second (TPS) meter during AI model streaming. Monospace bottom-right TUI slot, ~5s rolling window estimation.

- **Tech stack**: TypeScript 5.9+, Solid.js, OpenTUI (`@opentui/core`, `@opentui/solid`), Vitest
- **Target**: ESNext modules, `tsc` compilation, `dist/` output
- **Architecture**: Entrypoint `tps.tsx` → `setupHooks()` (event wiring) + `registerSlots()` (UI mount) → per-module logic in `src/`
- **Package manager**: npm (see `package-lock.json`, not Bun despite `bun.lock` in `.gitignore`)

### Key directories

| Path | Responsibility |
|------|---------------|
| `tps.tsx` | Plugin entrypoint — wires hooks and slots, exports `{ id, tui }` |
| `src/` | Core logic: types, constants, sampling, TPS calculation, session management, cleanup |
| `src/hooks.ts` | Event listener wiring: `message.part.delta`, `message.updated`, `session.created/updated`, 1s interval tick |
| `src/session.ts` | Session metadata, subagent tracking, API fetches for child/status resolution |
| `src/slots.tsx` | TUI slot registration (Solid.js JSX) — `session_prompt_right` and `sidebar_content` slots using OpenTUI components |
| `test/` | Vitest unit tests (one file per module) |
| `dist/` | Compiled JS output (auto-generated, do not edit) |
| `assets/` | Demo GIF and static assets |

## Build, Lint & Test Commands

```bash
# Install dependencies
npm install

# Build (compile TS to JS)
npm run build          # runs: tsc
npx tsc --noEmit      # type-check only (defined as /check command)

# Test
npm test               # runs: vitest run
npx vitest run         # same, full suite

# Run a single test file
npx vitest run test/tps-calc.test.ts

# Run a single test within a file (by describe block or it name)
npx vitest run test/tps-calc.test.ts -t "estimateTokens"
npx vitest run test/sampling.test.ts -t "clearLiveSamples"

# Watch mode
npm run test:watch     # runs: vitest

# Lint
npx eslint src/ test/

# Auto-fix lint issues
npx eslint --fix src/ test/

# Format check
npx prettier --check src/ test/

# Release (bump version + changelog)
npm run release        # runs: standard-version

# Pre-publish (runs automatically before npm publish)
npm run prepublishOnly # runs: npm run build
```

**Linter not configured** — ESLint (`eslint.config.*`) is absent from the project. The `opencode.json` `/lint` command references ESLint but will fail until a config is added.

Commands in `opencode.json`: `/check` (tsc --noEmit), `/test` (vitest run), `/lint` (eslint — non-functional, needs config), `/format` (prettier --check), `/build` (build → test).

## Code Style Guidelines

**Language & runtime**: TypeScript 5.9+, `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `jsx: react-jsx` with `jsxImportSource: @opentui/solid`. ES modules only (`"type": "module"` in package.json).

**Imports**: `import type { X }` for type-only imports. Order: external (`solid-js`, `@opencode-ai/*`, `@opentui/*`) → internal relative (`../src/`). One import group per module, no blank line between consecutive same-module imports.

**Formatting**: Prettier formatting expected (run `npx prettier --check src/ test/` to verify). 2-space indentation. Semicolons required. Trailing commas on multiline. Single quotes. No explicit line-length limit (Prettier default ~80).

**Types**:
- Prefer `interface` over `type` for object shapes and public APIs
- Use `type` for unions, tuples, and utility types
- Avoid `any` — use `unknown` and narrow with type guards or casts
- Use `as` casts when the type system can't infer from API responses (common in hooks.ts)
- Strict `null`/`undefined` handling via `strict: true`

**Naming**:
- Files: `kebab-case.ts` or `kebab-case.tsx` (src files), `kebab-case.test.ts` (tests)
- Variables/functions: `camelCase` — `pushSample`, `calcLiveTps`, `titleForSession`
- Interfaces/types: `PascalCase` — `PluginState`, `StreamSample`, `PartDeltaEvent`
- Constants: `UPPER_SNAKE_CASE` — `SAMPLE_WINDOW_MS`, `LIVE_STALE_MS`
- Exported functions: named exports, never `default` in src modules (only `tps.tsx` exports default)

**Error handling**: Catch and silently ignore non-critical errors (empty `catch {}` with explanatory comment or just `catch { // ignore }`). No error propagation for transient failures (API fetches, stale state). No error classes or wrapping — expected to fail harmlessly.

**Comments & docs**: No JSDoc in codebase — minimal inline comments only. Use `// ignore` style comments in `catch` blocks. Avoid redundant documentation of obvious logic. This file is the authoritative docs.

**Async patterns**: `async/await` for API calls. `Promise.all` with `map` for concurrent child session fetches. No manual promise chains. `setInterval` for periodic state pruning (1,000ms tick).

## Repository Conventions

**Git**: No commit message convention enforced. Branch naming: any. Prefer descriptive branch names from `/` prefix. No hooks or CI config present (no `.github/`, no `.gitlab-ci.yml`).

**Files/dirs**:
- `src/*.ts` / `src/*.tsx` — application logic
- `test/*.test.ts` — Vitest test files
- `dist/` — build output (do not edit)
- `assets/` — media (do not edit)
- `.gitignore`: `node_modules/`, `dist/`, `.env`, `*.log`, `.DS_Store`, `bun.lock`
- `opencode.json` — plugin config (do not modify plugin/command structure unless intentional)

**Environment variables**: None used in this plugin. Never hardcode secrets.

## Agent-Specific Instructions

**Never modify**:
- `opencode.json` (plugin config; change only if told to update command definitions)
- `dist/` — auto-generated build output
- `node_modules/` — dependencies
- `package-lock.json` — lockfile regenerated automatically

**Autonomy guidelines**:
- Run `/check` (or `npx tsc --noEmit`) after any code change
- Run `/test` (or `npx vitest run`) to verify no regressions
- Run `/format` (or `npx prettier --check src/ test/`) to verify formatting before finishing
- If a source file references an API that doesn't exist in the codebase, ask for clarification
- Tests use `createMockState()` pattern from `test/*.test.ts` — follow this when writing new tests
- Keep modules single-responsibility. New concerns → new file in `src/` or `test/`
