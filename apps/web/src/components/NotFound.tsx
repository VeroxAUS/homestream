import { Link } from 'react-router';
import { useContentShown } from '../lib/useContentShown';
import { Icon } from './Icon';
import styles from './NotFound.module.css';

interface NotFoundProps {
  title: string;
  message: string;
}

/** A page or title that does not exist: says so and leads back to Home. */
export function NotFound({ title, message }: NotFoundProps) {
  useContentShown();
  return (
    <main className={styles.page}>
      <Icon name="film" size={44} className={styles.icon} />
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      <Link to="/" className={styles.home}>
        Back to Home
      </Link>
    </main>
  );
}
