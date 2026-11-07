import styles from './ShortcutSheet.module.css';

type Combo = string[];
type Row = [label: string, combos: Combo[]];

const PLAYER: Row[] = [
  ['Play / pause', [['Space'], ['K']]],
  ['Back 10 s / forward 30 s', [['\u2190', '\u2192']]],
  ['Volume up / down', [['\u2191', '\u2193']]],
  ['Mute', [['M']]],
  ['Fullscreen (or double-click)', [['F']]],
  ['Subtitles on / off', [['C']]],
  ['Playback info', [['I']]],
  ['Mini player', [['P']]],
  ['Close menu, exit fullscreen, back', [['Esc']]],
];

const APP: Row[] = [
  ['Search', [['Ctrl', 'F'], ['/']]],
  ['Back / forward', [['Alt', '\u2190', '\u2192']]],
  ['This list', [['?']]],
  ['Zoom in / out / reset', [['Ctrl', '=', '-', '0']]],
  ['Fullscreen window', [['F11']]],
  ['Close to tray', [['Alt', 'F4']]],
];

function Keys({ rows }: { rows: Row[] }) {
  return (
    <dl className={styles.list}>
      {rows.map(([label, combos]) => (
        <div key={label} className={styles.row}>
          <dt>{label}</dt>
          <dd>
            {combos.map((combo, index) => (
              <span key={combo.join('+')} className={styles.combo}>
                {index > 0 ? <span className={styles.or}>or</span> : null}
                {combo.map((key) => (
                  <kbd key={key} className={styles.key}>
                    {key}
                  </kbd>
                ))}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 id="shortcut-title" className={styles.title}>
            Keyboard shortcuts
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Esc
          </button>
        </div>
        <div className={styles.columns}>
          <section aria-label="Player">
            <h3 className={styles.heading}>Player</h3>
            <Keys rows={PLAYER} />
          </section>
          <section aria-label="App">
            <h3 className={styles.heading}>App</h3>
            <Keys rows={APP} />
          </section>
        </div>
        <p className={styles.footer}>
          <strong>Media keys</strong> (keyboard, headset, Windows media flyout): Play/Pause toggles playback, Stop
          leaves the player, Next and Previous track jump +30 s and -10 s. They also work while HomeStream is in the
          background, and the Windows media flyout shows the title and poster.
        </p>
      </div>
    </div>
  );
}
