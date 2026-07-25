export const en = {
  app: {
    tagline: 'Guess where in the world you are.',
  },
  common: {
    continue: 'Continue playing',
    cancel: 'Cancel',
    got_it: 'Got it',
    reset: 'Reset',
  },
  plural: {
    rounds: { one: '{count} round', other: '{count} rounds' },
    players: { one: '{count} player', other: '{count} players' },
    seconds: { one: '{count} second', other: '{count} seconds' },
  },
  settings: {
    title: '{name} settings',
    appearance: {
      label: 'Appearance',
      hint: 'Match your system, or pick one.',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
    },
    language: {
      label: 'Language',
      hint: 'Choose your preferred language.',
    },
    round_timer: {
      label: 'Round timer',
      hint: 'Show a countdown while you explore.',
    },
    units: {
      label: 'Distance units',
      hint: 'Kilometres or miles.',
    },
    reduce_motion: {
      label: 'Reduce motion',
      hint: 'Minimise animations and transitions.',
    },
    best_score: {
      label: 'Best score',
      none: 'No games completed yet.',
    },
    location_history: {
      label: 'Recently played locations',
      hint: 'Clears the cooldown that keeps recently played spots from repeating in new games.',
    },
    footer_note: 'Preferences and your best score are stored only in this browser.',
    install: {
      label: 'Install {name}',
      ios: 'Tap the Share icon in Safari, then "Add to Home Screen".',
      generic:
        'Use your browser’s menu and choose "Install app" or "Add to Home Screen" for a full-screen, app-like experience.',
    },
  },
  exit: {
    solo: {
      title: 'Exit this game?',
      body: 'Your progress is only saved if you choose "Save and exit". Abandoning discards this run — it will not be recorded.',
      save_and_exit: 'Save and exit',
      abandon: 'Abandon game',
    },
    endless: {
      title: 'Exit Endless session?',
      body: 'You can finish now to see your session summary, or abandon without saving.',
      finish: 'Finish and view summary',
      abandon: 'Abandon session',
    },
    multiplayer: {
      title: 'Leave this room?',
      body: 'You will leave the room. Other players are notified and the match continues without you.',
      leave: 'Leave room',
    },
  },
} as const;

/** A pluralized entry — `one` is always required; the rest vary by language
 * (English only ever needs `other`; Russian needs `few`/`many` too). */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other?: string;
}

interface PluralDict {
  rounds: PluralForms;
  players: PluralForms;
  seconds: PluralForms;
}

/** Widens every leaf literal to its base type, so translations only need to
 * match shape (string-for-string) — not reproduce the English text. Plural
 * entries get their own, more permissive shape (see PluralForms above). */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type MessageDict = Omit<Widen<typeof en>, 'plural'> & { plural: PluralDict };
