import styles from './Toggle.module.css';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}
