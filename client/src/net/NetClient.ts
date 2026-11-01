/**
 * The only module that touches a raw browser `WebSocket`. Everything above
 * it deals only in typed, zod-validated ClientMessage/ServerMessage values
 * (shared/src/schemas.ts) - mirrors the split server/src/net/socket.ts
 * draws between wire handling and the sim layer.
 */
import { ClientMessageSchema, ServerMessageSchema, type ClientMessage, type ServerMessage } from '@terago/shared';

export type NetListener = (message: ServerMessage) => void;
export type NetCloseListener = (event: { code: number; reason: string }) => void;

/** The slice of the DOM `WebSocket` API NetClient needs - narrow enough
 * that tests can hand it a small fake instead of a real socket. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export interface NetClientOptions {
  /** Defaults to the browser's global `WebSocket`. Tests inject a fake. */
  createSocket?: (url: string) => WebSocketLike;
}

const OPEN = 1;

export class NetClient {
  private socket: WebSocketLike | null = null;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly messageListeners = new Set<NetListener>();
  private readonly closeListeners = new Set<NetCloseListener>();
  private readonly queue: ClientMessage[] = [];
  private connected = false;

  constructor(options: NetClientOptions = {}) {
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.connected = true;
        for (const message of this.queue.splice(0)) {
          socket.send(JSON.stringify(message));
        }
        resolve();
      });

      socket.addEventListener('message', (event) => {
        const raw = event.data;
        if (typeof raw !== 'string') return; // this protocol is JSON-over-text only
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch {
          console.warn('NetClient: dropped a non-JSON server message');
          return;
        }
        const result = ServerMessageSchema.safeParse(parsedJson);
        if (!result.success) {
          console.warn('NetClient: dropped a malformed server message', result.error.issues);
          return;
        }
        for (const listener of this.messageListeners) listener(result.data);
      });

      socket.addEventListener('close', (event) => {
        const wasConnected = this.connected;
        this.connected = false;
        for (const listener of this.closeListeners) listener(event);
        if (!wasConnected) reject(new Error(`WebSocket closed before opening (code ${event.code})`));
      });

      socket.addEventListener('error', () => {
        // 'close' always follows 'error' for browser WebSockets; nothing
        // extra to do here beyond not crashing on an unhandled event.
      });
    });
  }

  /** Validates and sends. If the socket isn't open yet, queues the message
   * and flushes it in order once `connect()`'s socket opens - lets callers
   * fire `auth:register` immediately after calling `connect()` without
   * awaiting it first. */
  send(message: ClientMessage): void {
    const result = ClientMessageSchema.safeParse(message);
    if (!result.success) {
      console.error('NetClient: refused to send an invalid message', message, result.error.issues);
      return;
    }
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(JSON.stringify(result.data));
    } else {
      this.queue.push(result.data);
    }
  }

  /** Returns an unsubscribe function, so a scene that tears down can stop
   * listening without NetClient needing to know about scene lifecycles. */
  onMessage(listener: NetListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: NetCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.socket?.close();
  }
}
