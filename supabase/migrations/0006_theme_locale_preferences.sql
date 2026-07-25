-- ============================================================================
-- Roam Foundation & Gameplay Polish V3 — theme + locale preference sync.
--
-- INCREMENTAL migration. Adds two nullable, strictly-validated columns to the
-- existing player_profiles table (safe backfill: NULL for every existing row,
-- meaning "no synced preference yet" — clients fall back to their local
-- value). Does not touch 0001-0005.
--
-- Sync model: local storage is always the immediate source of truth for first
-- paint (see src/hooks/useTheme.ts). This RPC only lets an existing profile
-- catch up to the client's local choice, or hand a first-time value back to a
-- fresh browser — never blocking, never authoritative over local state.
-- ============================================================================

alter table public.player_profiles
  add column if not exists theme_preference text
    check (theme_preference is null or theme_preference in ('light', 'dark', 'system'));

alter table public.player_profiles
  add column if not exists locale_preference text
    check (locale_preference is null or locale_preference in ('en', 'ru'));

-- Extend the existing profile read to also return the synced preferences.
-- Same signature/arg types as 0005 — safe to CREATE OR REPLACE in place.
create or replace function public.roam_get_profile()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    return json_build_object('exists', false);
  end if;

  select display_name, theme_preference, locale_preference
    into v_row
    from public.player_profiles
    where user_id = v_uid;

  if v_row is null then
    return json_build_object('exists', false);
  end if;

  update public.player_profiles set last_seen_at = now() where user_id = v_uid;

  return json_build_object(
    'exists', true,
    'display_name', v_row.display_name,
    'theme_preference', v_row.theme_preference,
    'locale_preference', v_row.locale_preference
  );
end;
$$;

-- Update only the preference columns of an existing profile row. A no-op
-- (exists: false) if the caller has no profile yet — preferences are only
-- synced once a player has completed name onboarding.
create or replace function public.roam_set_preferences(
  p_theme text default null,
  p_locale text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated boolean;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  if p_theme is not null and p_theme not in ('light', 'dark', 'system') then
    raise exception 'Invalid theme preference.';
  end if;
  if p_locale is not null and p_locale not in ('en', 'ru') then
    raise exception 'Invalid locale preference.';
  end if;

  update public.player_profiles
    set theme_preference = coalesce(p_theme, theme_preference),
        locale_preference = coalesce(p_locale, locale_preference),
        last_seen_at = now()
    where user_id = v_uid;

  v_updated := found;
  return json_build_object('exists', v_updated);
end;
$$;

revoke all on function public.roam_set_preferences(text, text) from public;
grant execute on function public.roam_set_preferences(text, text) to authenticated;
