import { EventEmitter } from 'node:events';

/**
 * In-process "this game changed" signal, used to push live updates to box-score viewers.
 * One API process serves everything today; with several processes this would move to Postgres LISTEN/NOTIFY.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function notifyGameChanged(gameId: number) {
  bus.emit(`game:${gameId}`);
}

/** Calls `fn` whenever the game changes; returns the unsubscribe function. */
export function onGameChanged(gameId: number, fn: () => void): () => void {
  bus.on(`game:${gameId}`, fn);
  return () => bus.off(`game:${gameId}`, fn);
}
