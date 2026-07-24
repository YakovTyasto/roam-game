# Private multiplayer setup

Roam's private 1v1 multiplayer is powered by [Supabase](https://supabase.com)
(Postgres + Row Level Security + Realtime + anonymous auth). Solo play needs
nothing here — multiplayer is entirely optional and the app builds, tests, and
runs without any Supabase configuration (the multiplayer menu shows a friendly
"not set up" message instead).

Everything below uses the **publishable (browser) key only**. Never put a
secret/service_role key in the frontend, in `.env`, or in Vercel's client
variables — Row Level Security is what actually protects the data.

---

## 1. Create a Supabase project

1. Sign in at <https://supabase.com> and create a new project.
2. Pick a region close to your players and set a database password (you won't
   need it for the app — RPCs use anonymous auth).

## 2. Find your Project URL and publishable key

In the dashboard: **Project Settings → API**.

- **Project URL** → this is `VITE_SUPABASE_URL`
  (e.g. `https://abcdefgh.supabase.co`).
- **Publishable / anon key** (the public `anon` key, safe for browsers) → this
  is `VITE_SUPABASE_PUBLISHABLE_KEY`.

> Do **not** copy the `service_role` / secret key. It bypasses RLS and must
> never reach the browser.

## 3. Enable anonymous sign-ins

**Authentication → Sign In / Providers → Anonymous Sign-Ins → Enable.**

Players get a persistent anonymous identity (`auth.uid()`) without creating an
account. Note the limitation: an anonymous identity lives only in that browser's
storage. Clearing site data, using a private window, or switching devices
creates a brand-new identity that cannot rejoin a room as the same player.

## 4. Apply the SQL migration

Open **SQL Editor** and run the two migration files, in order:

1. `supabase/migrations/0001_multiplayer_schema.sql`
2. `supabase/migrations/0002_multiplayer_functions.sql`

Paste each file's contents and click **Run**. (Or, with the Supabase CLI:
`supabase db push`.)

This creates the tables, constraints, RLS policies, the transactional RPC
functions, and the scoring functions. It is safe to re-run.

## 5. Confirm the Realtime publication

The migration adds the multiplayer tables to the `supabase_realtime`
publication automatically. To verify: **Database → Publications →
`supabase_realtime`** should list `multiplayer_rooms`, `multiplayer_players`,
`multiplayer_rounds`, `multiplayer_round_targets`, and `multiplayer_guesses`.

Realtime respects RLS, so players only receive changes for rooms they belong to,
and opponent guesses / round answers are never streamed before the reveal.

## 6. Add local environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

`.env.local` (git-ignored — never commit it):

```
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_anon_key
```

Multiplayer also needs the Google Maps key (both players render Street View).
Restart `npm run dev` after editing `.env.local`.

## 7. Add the variables to Vercel

In your Vercel project: **Settings → Environment Variables**. Add all three for
**Production, Preview, and Development**:

| Name | Value |
| --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | your Google Maps browser key |
| `VITE_SUPABASE_URL` | your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | your Supabase publishable key |

Build command `npm run build`, output directory `dist` (Vite defaults). No
server is required — the app is fully static and talks to Supabase directly.

## 8. Redeploy

Vercel only picks up env-var changes on a new deployment — trigger a redeploy
after adding them.

## 9. Test with two separate sessions

1. Open the app, choose **Private multiplayer**, enter a name, **Create
   private game**.
2. In a **second browser or an incognito window** (a different anonymous
   identity), open the app, enter the room code (or the invite link), and
   **Join**.
3. The host presses **Start game**. Both players get the same five locations in
   the same order, guess independently, and see results after both submit or
   the timer runs out.

## 10. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Multiplayer isn't set up yet" | `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` missing. Add them and restart dev / redeploy. |
| "Add a Google Maps key" in multiplayer | `VITE_GOOGLE_MAPS_API_KEY` missing — multiplayer needs it for Street View. |
| "Could not start an anonymous session…" | Anonymous sign-ins are disabled (step 3). |
| Join always says "Room not found" | Codes are case-insensitive but must match; make sure the migration ran and RLS/RPCs exist. |
| Nothing updates for the other player | Realtime publication missing (step 5), or the tables aren't in `supabase_realtime`. The app also refetches on a short poll, so updates should still arrive within a couple of seconds. |
| "permission denied for table…" in the console | You tried to read/write a table directly. All writes go through the RPCs; only SELECT is granted (and RLS-filtered). This is expected for direct writes. |
| Vercel deploy works but multiplayer doesn't | Env vars not set for the deployed environment, or you deployed before adding them — set all three and redeploy. |

## Security & trust model (MVP)

- Only the **publishable** key is used client-side; RLS + SECURITY DEFINER RPCs
  are the real protection. Direct table writes are not granted.
- Scores are computed on the **server** (the DB) with the exact solo formula.
- Opponent guesses and round answers are withheld by RLS until the round is
  complete (both submitted, or the server-authoritative timer expired).
- **Honest limitation:** the current round's panorama must render on both
  clients, so its pano id is necessarily readable by participants. A
  technically sophisticated player could resolve a pano id back to coordinates
  via Google — perfect concealment of the answer is impossible for a
  client-rendered panorama, and this is a friends-only MVP, not an anti-cheat
  system. Ordinary UI/state/database tampering is prevented; the opponent's
  guess is never revealed early.

See `supabase/tests/` for a runnable script that asserts these guarantees
(two-player cap, host-only start, one-guess-per-round, hidden targets/guesses,
no direct score edits, safe duplicate advancement, timer enforcement).
