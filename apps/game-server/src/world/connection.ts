import type { ServerToClientEvents } from '@terrago/shared';

/**
 * What the world needs from a client connection. Implemented by a Socket.IO
 * socket adapter in production and by in-memory fakes in tests.
 */
export interface Connection {
  readonly id: string;
  send<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  /** Fire-and-forget: may be dropped if the client is congested (used for snapshots). */
  sendVolatile<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  close(): void;
}
