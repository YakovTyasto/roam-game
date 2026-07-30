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
  daily: {
    title: 'Daily Challenge',
    subtitle: 'One set of five places. Everyone in the world gets the same ones today.',
    card: {
      not_started: 'Play today’s challenge',
      in_progress: 'Continue — {played} of {total} rounds done',
      completed: 'Completed · {score} points',
      unavailable: 'Daily Challenge is offline',
      unavailable_hint: 'It needs a connection. Classic Solo still works.',
      rank: 'Rank #{rank}',
      players: '{count} players finished today',
      next_in: 'Next challenge in {time}',
    },
    play: 'Play today’s challenge',
    resume: 'Continue today’s challenge',
    practice: 'Replay for practice',
    practice_hint: 'Practice runs are never scored and never change your result.',
    already_completed: 'You’ve already played today. Come back after the reset.',
    result: {
      title: 'Today’s result',
      score: 'Score',
      distance: 'Total distance',
      duration: 'Time',
      rank: 'Rank',
      pending: 'Not played yet',
    },
    previous: {
      title: 'Yesterday',
      none: 'You didn’t play yesterday.',
    },
    leaderboard: {
      title: 'Today’s leaderboard',
      empty: 'Nobody has finished today yet. Be first.',
      you: 'You',
      unavailable: 'The leaderboard couldn’t be loaded.',
      retry: 'Try again',
      tiebreak: 'Ties break by score, then shortest total distance, then fastest time.',
      header_rank: '#',
      header_player: 'Player',
      header_score: 'Score',
      header_distance: 'Distance',
      header_time: 'Time',
    },
  },
  challenge: {
    title: 'Challenge a friend',
    subtitle: 'Create a link. Everyone who opens it plays the same places, once.',
    create: {
      heading: 'Create a challenge',
      name_label: 'Challenge name',
      name_placeholder: 'Friday night five',
      rounds_label: 'Rounds',
      timer_label: 'Round timer',
      timer_off: 'No timer',
      expiry_label: 'Link expires',
      expiry_day: '24 hours',
      expiry_week: '7 days',
      expiry_month: '30 days',
      submit: 'Create challenge link',
    },
    join: {
      heading: 'Open a challenge',
      code_label: 'Challenge code',
      submit: 'Open challenge',
    },
    share: {
      heading: 'Share this challenge',
      button: 'Share link',
      copy: 'Copy link',
      copied: 'Link copied',
      shared: 'Shared',
      failed: 'Copy this link:',
      code_label: 'Code',
    },
    detail: {
      created_by: 'Created by {name}',
      rounds: '{count} rounds',
      expires: 'Expires {when}',
      players: '{count} players finished',
      play: 'Play this challenge',
      resume: 'Continue this challenge',
      completed: 'You finished this challenge',
      your_score: 'Your score',
      your_rank: 'Your rank',
      play_another: 'Create another challenge',
    },
    error: {
      not_found: 'That challenge link isn’t valid.',
      not_found_hint: 'Check the code, or ask for a fresh link.',
      expired: 'That challenge has expired.',
      expired_hint: 'Challenge links don’t last forever. Ask for a new one.',
      offline: 'Challenges need a connection.',
      offline_hint: 'Classic Solo still works offline.',
      home: 'Back to home',
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
