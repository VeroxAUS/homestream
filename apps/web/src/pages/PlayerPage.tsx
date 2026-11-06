import { NotFound } from '../components/NotFound';

/** Holds the `/play/...` routes until the player is built. */
export default function PlayerPage() {
  return (
    <NotFound title="Player not available yet" message="Playback is not built into this version of the web app." />
  );
}
