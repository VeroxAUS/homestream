/** "2h 22m" for a movie, "45m" under an hour. */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "47 min" for an episode row. */
export function formatEpisodeRuntime(minutes: number): string {
  return `${minutes} min`;
}

/** "1:02:13" or "2:05", for a playback position. */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = String(sec % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** "1 h 20 min left" or "12 min left"; "less than a minute left" at the very end. */
export function formatRemaining(positionSec: number, durationSec: number): string {
  const minutes = Math.round(Math.max(0, durationSec - positionSec) / 60);
  if (minutes < 1) return 'less than a minute left';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min left` : `${minutes} min left`;
}

/** Share of the title that was watched, as a fraction clamped to 0..1. */
export function watchedFraction(positionSec: number, durationSec: number): number {
  return durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
}

/** "S1E3": the form the validation contract and the player header use. */
export function formatEpisodeCode(season: number, episode: number): string {
  return `S${season}E${episode}`;
}
