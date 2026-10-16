import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { keys } from './queries';

/**
 * Listens to the server's live stream for one game and refreshes its box score (and game lists)
 * as soon as a play is recorded. Bursts of plays are folded into one refresh.
 */
export function useGameStream(gameId: number, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/games/${gameId}/stream`);
    let timer: number | undefined;
    es.addEventListener('change', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: keys.boxscore(gameId) });
        qc.invalidateQueries({ queryKey: ['games'] });
      }, 400);
    });
    return () => {
      window.clearTimeout(timer);
      es.close();
    };
  }, [gameId, enabled, qc]);
}
