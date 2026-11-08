import { useRef, type KeyboardEvent } from 'react';
import { SETTINGS_TABS, type SettingsTab } from './useSettingsTab';
import styles from './SettingsTabs.module.css';

const LABELS: Record<SettingsTab, string> = { settings: 'Settings', about: 'About' };

export const tabId = (tab: SettingsTab): string => `settings-tab-${tab}`;
export const panelId = (tab: SettingsTab): string => `settings-panel-${tab}`;

function targetFor(key: string, index: number): number | null {
  const last = SETTINGS_TABS.length - 1;
  if (key === 'ArrowRight') return index === last ? 0 : index + 1;
  if (key === 'ArrowLeft') return index === 0 ? last : index - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

interface SettingsTabsProps {
  active: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}

/** Underline tabs with a roving tabindex; arrow keys and Home/End select and focus, Enter/Space click the button. */
export function SettingsTabs({ active, onSelect }: SettingsTabsProps) {
  const refs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const target = targetFor(event.key, index);
    const next = target === null ? undefined : SETTINGS_TABS[target];
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label="Settings sections">
      {SETTINGS_TABS.map((tab, index) => (
        <button
          key={tab}
          ref={(node) => {
            refs.current[tab] = node;
          }}
          id={tabId(tab)}
          type="button"
          role="tab"
          aria-selected={tab === active}
          aria-controls={panelId(tab)}
          tabIndex={tab === active ? 0 : -1}
          className={`${styles.tab} ${tab === active ? styles.active : ''}`}
          onClick={() => onSelect(tab)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {LABELS[tab]}
        </button>
      ))}
    </div>
  );
}
