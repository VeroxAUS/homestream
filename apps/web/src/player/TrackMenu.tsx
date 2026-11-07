import { Icon } from '../components/Icon';
import styles from './TrackMenu.module.css';

export interface MenuItem {
  key: string;
  label: string;
  detail?: string | null;
  selected: boolean;
  onSelect: () => void;
}

interface TrackMenuProps {
  heading: string;
  items: MenuItem[];
  onClose: () => void;
}

/** A pop-up list with one checked row. Choosing a row closes the menu. */
export function TrackMenu({ heading, items, onClose }: TrackMenuProps) {
  return (
    <div className={styles.menu} role="menu" aria-label={heading}>
      <h4 className={styles.heading}>{heading}</h4>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitemradio"
          aria-checked={item.selected}
          className={styles.item}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span className={styles.check}>{item.selected ? <Icon name="check" size={16} /> : null}</span>
          <span>
            {item.label}
            {item.detail ? <small className={styles.detail}>{item.detail}</small> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
