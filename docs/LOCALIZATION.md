# Localization (EN/RU)

Typed i18n system: `src/i18n/locale.ts` (locale detection/validation),
`src/i18n/t.ts` (`t()` for plain strings, `tPlural()` for pluralized values),
`src/i18n/messages/{en,ru}.ts` (the dictionaries — `ru.ts` is type-checked
against `en.ts`'s shape via `satisfies MessageDict`, so a missing or
mis-shaped key is a compile error, not a runtime surprise).

## What's covered

- `src/hooks/useLocale.ts` — local-first persistence (`roam.locale.v1`,
  versioned, malformed data fails safe to the browser-language default),
  mirroring `useTheme`'s pattern exactly.
- Default locale comes from `navigator.languages` (falls back to English for
  anything unsupported).
- Optional profile sync via the existing `roam_set_preferences` RPC
  (migration 0006 already added `locale_preference` — this phase wires the
  client side, following the same non-blocking adopt-or-push logic as theme
  sync in `App.tsx`).
- Language selector in Settings (`SettingsContent.tsx`), fully translated.
- The exit-confirmation dialog (`ExitConfirmDialog.tsx`) — proves
  interpolation (`{name}`) and the plural system work with real usage, not
  just in tests.
- `document.documentElement.lang` kept in sync for assistive technology.
- Tests: fallback (`t.test.ts`), persistence/malformed-data/browser-default
  (`useLocale.test.ts`), interpolation, and Russian plural behavior
  (one/few/many by the standard last-digit rule, including the -teen
  exception) — all in `src/i18n/t.test.ts`.

## What's not covered in this pass (known limitation)

Full app-wide coverage — replacing every hardcoded string in every
screen/component — was not completed. Covered: Settings and the exit
dialog. **Not yet migrated:** WelcomeScreen, SoloSetupScreen, GameScreen/HUD,
FinalScreen, LeaderboardScreen, ErrorScreen, NameScreen, ResumePromptScreen,
and the entire multiplayer UI (Lobby, MultiplayerGame, MultiplayerMenu,
MultiplayerFinal) — these still render English text directly.

`ExitConfirmDialog`'s `locale` prop defaults to English and is only threaded
through from `GameScreen` (the solo call site); the two multiplayer call
sites (`MultiplayerGame.tsx`, `Lobby.tsx`) don't yet pass the player's
locale.

This was a deliberate scope decision under time constraints, not an
oversight: migrating every remaining screen is mechanical (add keys to both
dictionaries, replace the JSX string with `t(locale, 'the.key')`, thread
`locale` through the prop chain from `App.tsx`) but touches on the order of
20+ files, and doing it well — plural forms and interpolation used correctly
throughout, not just find/replace — needs the same care as the two screens
done here, not a rushed mechanical pass. `docs/ANTI_ABUSE.md` documents the
same kind of "proven pattern, remaining work enumerated" scope cut for
rate-limiting, for the same reason.

### Suggested order for finishing the migration

1. `WelcomeScreen` + `SettingsContent`'s remaining untranslated strings
   (display name section) — highest visibility.
2. `GameScreen`/`HUD` — round/score/timer labels, including the
   `plural.rounds`/`plural.seconds` keys that already exist and are unused
   outside the exit dialog today.
3. `FinalScreen` + `ResumePromptScreen` (already uses `plural.rounds`-shaped
   data, needs wiring).
4. `ErrorScreen`, `NameScreen`, `SetupScreen`.
5. Multiplayer screens last (largest surface area, lowest solo-player
   impact) — thread `locale` from `App.tsx` into `MultiplayerApp` and down
   to `Lobby`/`MultiplayerGame`/`MultiplayerMenu`/`MultiplayerFinal`, and
   pass it into the two `ExitConfirmDialog` call sites there.
6. Route RPC/normalized error messages (`src/errors/normalize.ts`,
   `src/utils/rateLimit.ts`) through `t()` instead of hardcoded English —
   today `userMessage` values are English literals regardless of locale.

### A responsive issue this pass surfaced

Switching to Russian in Settings showed a real layout gap: Russian strings
run longer than their English counterparts ("Недавние локации", "Сбросить")
and the Settings modal's row layout clips them at narrow widths instead of
wrapping. This needs a CSS fix (`.row`/`.rowText` flex-wrap, or trimming the
segmented-control button padding) as part of the accessibility/responsive
pass — tracked there rather than papered over here, since it's a layout
concern, not a translation-content concern.
