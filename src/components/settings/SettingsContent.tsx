import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { Preferences } from '../../types';
import { APP } from '../../config/app';
import type { ThemePreference } from '../../config/theme';
import type { Locale } from '../../i18n/locale';
import { t } from '../../i18n/t';
import { MAX_PLAYER_NAME_LENGTH } from '../../multiplayer/playerName';
import { isIos, shouldShowInstallHint, writeInstallHintDismissed } from '../../pwa/pwaInstall';
import { Button } from '../ui/Button';
import styles from './SettingsContent.module.css';

interface SettingsContentProps {
  preferences: Preferences;
  bestScore: number;
  /** Current display name (null before onboarding). */
  playerName: string | null;
  /** Whether online services are reachable (affects the name-change hint). */
  online: boolean;
  savingName: boolean;
  nameError: string | null;
  themePreference: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
  locale: Locale;
  onChangeLocale: (locale: Locale) => void;
  onChangeName: (name: string) => void;
  onChange: (patch: Partial<Preferences>) => void;
  onResetBest: () => void;
  onResetLocationHistory: () => void;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} aria-hidden />
    </button>
  );
}

export function SettingsContent({
  preferences,
  bestScore,
  playerName,
  online,
  savingName,
  nameError,
  themePreference,
  onChangeTheme,
  locale,
  onChangeLocale,
  onChangeName,
  onChange,
  onResetBest,
  onResetLocationHistory,
}: SettingsContentProps) {
  const tr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t(locale, key, params);
  const [nameDraft, setNameDraft] = useState(playerName ?? '');
  const [editingName, setEditingName] = useState(false);

  // Keep the draft in sync when the confirmed name changes (e.g. after save).
  useEffect(() => {
    if (!editingName) setNameDraft(playerName ?? '');
  }, [playerName, editingName]);

  const dirty = nameDraft.trim().length > 0 && nameDraft.trim() !== playerName;

  // Computed once on mount (browser APIs) — never re-checked mid-session, so
  // dismissing it can't be undone by a re-render, and it never pops up
  // unprompted outside Settings.
  const [showInstallHint, setShowInstallHint] = useState(false);
  useEffect(() => {
    setShowInstallHint(shouldShowInstallHint());
  }, []);

  return (
    <div>
      <div className={styles.list}>
        {playerName !== null && (
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Display name</span>
              <span className={styles.rowHint}>
                Shown on multiplayer scoreboards and the weekly leaderboard.
                {!online && ' Online services are currently unavailable.'}
              </span>
              {nameError && (
                <span className={styles.rowHint} role="alert" style={{ color: 'var(--danger)' }}>
                  {nameError}
                </span>
              )}
              <div className={styles.nameEdit}>
                <input
                  className={styles.nameInput}
                  value={nameDraft}
                  onFocus={() => setEditingName(true)}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={MAX_PLAYER_NAME_LENGTH}
                  aria-label="Display name"
                  autoComplete="nickname"
                />
                <Button
                  variant="primary"
                  onClick={() => {
                    onChangeName(nameDraft);
                    setEditingName(false);
                  }}
                  disabled={!dirty || savingName}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        )}
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.appearance.label')}</span>
            <span className={styles.rowHint}>{tr('settings.appearance.hint')}</span>
          </div>
          <div className={styles.segment} role="group" aria-label={tr('settings.appearance.label')}>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={themePreference === 'system'}
              onClick={() => onChangeTheme('system')}
            >
              {tr('settings.appearance.system')}
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={themePreference === 'light'}
              onClick={() => onChangeTheme('light')}
            >
              {tr('settings.appearance.light')}
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={themePreference === 'dark'}
              onClick={() => onChangeTheme('dark')}
            >
              {tr('settings.appearance.dark')}
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.language.label')}</span>
            <span className={styles.rowHint}>{tr('settings.language.hint')}</span>
          </div>
          <div className={styles.segment} role="group" aria-label={tr('settings.language.label')}>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={locale === 'en'}
              onClick={() => onChangeLocale('en')}
            >
              English
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={locale === 'ru'}
              onClick={() => onChangeLocale('ru')}
            >
              Русский
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.round_timer.label')}</span>
            <span className={styles.rowHint}>{tr('settings.round_timer.hint')}</span>
          </div>
          <Toggle
            label={tr('settings.round_timer.label')}
            checked={preferences.timer}
            onChange={(timer) => onChange({ timer })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.units.label')}</span>
            <span className={styles.rowHint}>{tr('settings.units.hint')}</span>
          </div>
          <div className={styles.segment} role="group" aria-label={tr('settings.units.label')}>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={preferences.units === 'metric'}
              onClick={() => onChange({ units: 'metric' })}
            >
              km
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={preferences.units === 'imperial'}
              onClick={() => onChange({ units: 'imperial' })}
            >
              mi
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.reduce_motion.label')}</span>
            <span className={styles.rowHint}>{tr('settings.reduce_motion.hint')}</span>
          </div>
          <Toggle
            label={tr('settings.reduce_motion.label')}
            checked={preferences.reduceMotion}
            onChange={(reduceMotion) => onChange({ reduceMotion })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.best_score.label')}</span>
            <span className={styles.rowHint}>
              {bestScore > 0
                ? `${bestScore.toLocaleString()} / ${(
                    APP.maxRoundScore * APP.roundsPerGame
                  ).toLocaleString()}`
                : tr('settings.best_score.none')}
            </span>
          </div>
          <button
            type="button"
            className={styles.segmentButton}
            onClick={onResetBest}
            disabled={bestScore <= 0}
            style={{
              border: '1px solid var(--panel-border)',
              opacity: bestScore <= 0 ? 0.5 : 1,
            }}
          >
            {tr('common.reset')}
          </button>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{tr('settings.location_history.label')}</span>
            <span className={styles.rowHint}>{tr('settings.location_history.hint')}</span>
          </div>
          <button
            type="button"
            className={styles.segmentButton}
            onClick={onResetLocationHistory}
            style={{ border: '1px solid var(--panel-border)' }}
          >
            {tr('common.reset')}
          </button>
        </div>
      </div>

      {showInstallHint && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>
              <Smartphone size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {tr('settings.install.label', { name: APP.name })}
            </span>
            <span className={styles.rowHint}>
              {isIos() ? tr('settings.install.ios') : tr('settings.install.generic')}
            </span>
          </div>
          <button
            type="button"
            className={styles.segmentButton}
            onClick={() => {
              writeInstallHintDismissed();
              setShowInstallHint(false);
            }}
            style={{ border: '1px solid var(--panel-border)' }}
          >
            {tr('common.got_it')}
          </button>
        </div>
      )}

      <p className={styles.footerNote}>{tr('settings.footer_note')}</p>
    </div>
  );
}
