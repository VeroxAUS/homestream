import type { FeaturedItem } from '@homestream/shared';
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useBannerIntervalMs } from '../lib/bannerInterval';
import { tmdbImage } from '../lib/images';
import { useReducedMotion } from '../lib/useReducedMotion';
import { Icon } from './Icon';
import styles from './Banner.module.css';

const VISIBLE_THRESHOLD = 0.3;

interface SlideProps {
  item: FeaturedItem;
  active: boolean;
  /** A slide's image is only requested once it is the current or the next one. */
  loadImage: boolean;
  first: boolean;
  onImageDone: (() => void) | undefined;
}

const BannerSlide = memo(function BannerSlide({ item, active, loadImage, first, onImageDone }: SlideProps) {
  const detailsPath = `${item.mediaType === 'movie' ? '/movie' : '/tv'}/${item.tmdbId}`;
  const image = loadImage ? tmdbImage(item.backdropUrl, 'w1280') : null;
  return (
    <article className={`${styles.slide} ${active ? styles.active : ''}`} inert={!active} aria-hidden={!active}>
      {image ? (
        <img
          className={styles.image}
          src={image}
          alt=""
          width={1280}
          height={720}
          decoding="async"
          fetchPriority={first ? 'high' : 'auto'}
          onLoad={onImageDone}
          onError={onImageDone}
        />
      ) : null}
      <div className={styles.shadeSide} aria-hidden="true" />
      <div className={styles.shadeBottom} aria-hidden="true" />
      <div className={styles.content}>
        <p className={styles.kicker}>{item.reasonLabel}</p>
        <h2 className={styles.title}>{item.title}</h2>
        <p className={styles.meta}>{item.mediaType === 'movie' ? 'Movie' : 'Series'}</p>
        <p className={styles.overview}>{item.overview}</p>
        <div className={styles.actions}>
          {item.mediaType === 'movie' ? (
            <Link to={`/play/movie/${item.tmdbId}`} className={styles.primary}>
              <Icon name="play" size={18} />
              Play
            </Link>
          ) : (
            <Link to={detailsPath} className={styles.primary}>
              View show
            </Link>
          )}
          <Link to={detailsPath} className={styles.secondary}>
            More info
          </Link>
        </div>
      </div>
    </article>
  );
});

export function Banner({ items }: { items: readonly FeaturedItem[] }) {
  const count = items.length;
  const intervalMs = useBannerIntervalMs();
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [loadable, setLoadable] = useState<ReadonlySet<number>>(() => new Set([0]));
  const root = useRef<HTMLElement>(null);
  const dots = useRef<Array<HTMLButtonElement | null>>([]);

  const allowImage = useCallback((slide: number) => {
    setLoadable((current) => (current.has(slide) ? current : new Set(current).add(slide)));
  }, []);
  const firstImageDone = useCallback(() => allowImage(1), [allowImage]);

  const rotating = count > 1 && !reducedMotion && !hovered && !focused && onScreen;

  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => setIndex((current) => (current + 1) % count), intervalMs);
    return () => clearTimeout(timer);
  }, [rotating, index, count, intervalMs]);

  useEffect(() => {
    if (index === 0) return;
    allowImage(index);
    allowImage((index + 1) % count);
  }, [index, count, allowImage]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)), {
      threshold: VISIBLE_THRESHOLD,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const go = useCallback(
    (target: number, focusDot = false) => {
      const next = (target + count) % count;
      setIndex(next);
      if (focusDot) dots.current[next]?.focus();
    },
    [count],
  );

  const onDotKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    go(index + (event.key === 'ArrowRight' ? 1 : -1), true);
  };

  if (count === 0) return null;
  const controls = count > 1;
  return (
    <section
      ref={root}
      className={styles.banner}
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      style={{ '--interval': `${intervalMs}ms` } as CSSProperties}
    >
      <div aria-live={rotating ? 'off' : 'polite'}>
        {items.map((item, slide) => (
          <BannerSlide
            key={`${item.mediaType}:${item.tmdbId}`}
            item={item}
            active={slide === index}
            loadImage={loadable.has(slide)}
            first={slide === 0}
            onImageDone={slide === 0 ? firstImageDone : undefined}
          />
        ))}
      </div>
      {controls ? (
        <>
          <button
            type="button"
            className={`${styles.arrow} ${styles.prev}`}
            aria-label="Previous featured title"
            onClick={() => go(index - 1)}
          >
            <Icon name="chevronLeft" size={22} />
          </button>
          <button
            type="button"
            className={`${styles.arrow} ${styles.next}`}
            aria-label="Next featured title"
            onClick={() => go(index + 1)}
          >
            <Icon name="chevronRight" size={22} />
          </button>
          <div className={styles.dots} onKeyDown={onDotKey}>
            {items.map((item, slide) => (
              <button
                key={`${item.mediaType}:${item.tmdbId}`}
                ref={(element) => {
                  dots.current[slide] = element;
                }}
                type="button"
                className={styles.dot}
                aria-label={`Show featured ${slide + 1} of ${count}: ${item.title}`}
                aria-current={slide === index ? 'true' : undefined}
                onClick={() => go(slide)}
              >
                {slide === index ? (
                  <span
                    key={rotating ? 'running' : 'idle'}
                    className={`${styles.fill} ${rotating ? styles.filling : ''}`}
                  />
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
