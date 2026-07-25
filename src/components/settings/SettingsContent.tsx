import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { Preferences } from '../../types';
import { APP } from '../../config/app';
import type { ThemePreference } from '../../config/theme';
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
  onChangeName,
  onChange,
  onResetBest,
  onResetLocationHistory,
}: SettingsContentProps) {
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
            <span className={styles.rowLabel}>Appearance</span>
            <span className={styles.rowHint}>Match your system, or pick one.</span>
          </div>
          <div className={styles.segment} role="group" aria-label="Appearance">
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={themePreference === 'system'}
              onClick={() => onChangeTheme('system')}
            >
              System
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={themePreference === 'light'}
              onClick={() => onChangeTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={themePreference === 'dark'}
              onClick={() => onChangeTheme('dark')}
            >
              Dark
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Round timer</span>
            <span className={styles.rowHint}>
              Show a countdown while you explore.
            </span>
          </div>
          <Toggle
            label="Round timer"
            checked={preferences.timer}
            onChange={(timer) => onChange({ timer })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Distance units</span>
            <span className={styles.rowHint}>Kilometres or miles.</span>
          </div>
          <div className={styles.segment} role="group" aria-label="Distance units">
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
            <span className={styles.rowLabel}>Reduce motion</span>
            <span className={styles.rowHint}>
              Minimise animations and transitions.
            </span>
          </div>
          <Toggle
            label="Reduce motion"
            checked={preferences.reduceMotion}
            onChange={(reduceMotion) => onChange({ reduceMotion })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Best score</span>
            <span className={styles.rowHint}>
              {bestScore > 0
                ? `${bestScore.toLocaleString()} / ${(
                    APP.maxRoundScore * APP.roundsPerGame
                  ).toLocaleString()}`
                : 'No games completed yet.'}
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
            Reset
          </button>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Recently played locations</span>
            <span className={styles.rowHint}>
              Clears the cooldown that keeps recently played spots from
              repeating in new games.
            </span>
          </div>
          <button
            type="button"
            className={styles.segmentButton}
            onClick={onResetLocationHistory}
            style={{ border: '1px solid var(--panel-border)' }}
          >
            Reset
          </button>
        </div>
      </div>

      {showInstallHint && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>
              <Smartphone size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Install {APP.name}
            </span>
            <span className={styles.rowHint}>
              {isIos()
                ? 'Tap the Share icon in Safari, then "Add to Home Screen".'
                : 'Use your browser’s menu and choose "Install app" or "Add to Home Screen" for a full-screen, app-like experience.'}
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
            Got it
          </button>
        </div>
      )}

      <p className={styles.footerNote}>
        Preferences and your best score are stored only in this browser.
      </p>
    </div>
  );
}
