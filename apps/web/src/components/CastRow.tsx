import type { CastMember } from '@homestream/shared';
import { useState } from 'react';
import { tmdbImage } from '../lib/images';
import { RowItem, RowSection } from './RowSection';
import styles from './CastRow.module.css';

/** First letters of the first and last word of the name ("Stub Person" gives "SP"). */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return '';
  const letters = words.length > 1 ? [first, last] : [first];
  return letters.map((word) => word.charAt(0).toUpperCase()).join('');
}

function CastPhoto({ member }: { member: CastMember }) {
  const [broken, setBroken] = useState(false);
  const photo = broken ? null : tmdbImage(member.profileUrl, 'w185');
  return (
    <span className={styles.photo} data-testid="cast-photo">
      {photo ? (
        <img
          src={photo}
          alt=""
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initialsOf(member.name)}
        </span>
      )}
    </span>
  );
}

export function CastRow({ cast }: { cast: readonly CastMember[] }) {
  return (
    <RowSection title="Cast" belowFold compact>
      {cast.map((member, index) => (
        <RowItem key={`${index}:${member.name}`}>
          <div className={styles.member}>
            <CastPhoto member={member} />
            <span className={styles.name}>{member.name}</span>
            {member.character ? <span className={styles.character}>{member.character}</span> : null}
          </div>
        </RowItem>
      ))}
    </RowSection>
  );
}
