import { describe, expect, it, vi } from 'vitest';
import type { WebSocketLike } from './NetClient.js';
import { NetClient } from './NetClient.js';

/** A minimal WebSocketLike test double, driven manually via `openNow()` /
 * `receive()` / `closeNow()` rather than a real network connection -
 * mirrors how server/src/net/socket.test.ts fakes the `ws` side. */
class FakeSocket implements WebSocketLike {
  readyState = 0; // WebSocket.CONNECTING
  sent: string[] = [];
  closed = false;
  private openListeners: Array<() => void> = [];
  private messageListeners: Array<(event: { data: unknown }) => void> = [];
  private closeListeners: Array<(event: { code: number; reason: string }) => void> = [];

  addEventListener(type: string, listener: (...args: never[]) => void): void {
    if (type === 'open') this.openListeners.push(listener as () => void);
    else if (type === 'message') this.messageListeners.push(listener as (event: { data: unknown }) => void);
    else if (type === 'close') this.closeListeners.push(listener as (event: { code: number; reason: string }) => void);
    // 'error' listeners are accepted and ignored, same as NetClient's own handling.
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  openNow(): void {
    this.readyState = 1; // WebSocket.OPEN
    for (const l of this.openListeners) l();
  }

  receive(data: unknown): void {
    for (const l of this.messageListeners) l({ data });
  }

  closeNow(code = 1000, reason = ''): void {
    for (const l of this.closeListeners) l({ code, reason });
  }
}

function makeClient() {
  const socket = new FakeSocket();
  const client = new NetClient({ createSocket: () => socket });
  return { socket, client };
}

describe('NetClient: sending', () => {
  it('queues a message sent before the socket opens, then flushes it in order on open', () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');

    client.send({ t: 'auth:register', username: 'alice', password: 'correct-horse' });
    client.send({ t: 'chat:send', channel: 'global', text: 'hi' });
    expect(socket.sent).toHaveLength(0);

    socket.openNow();
    return connectPromise.then(() => {
      expect(socket.sent).toHaveLength(2);
      expect(JSON.parse(socket.sent[0]!)).toMatchObject({ t: 'auth:register' });
      expect(JSON.parse(socket.sent[1]!)).toMatchObject({ t: 'chat:send' });
    });
  });

  it('sends immediately once the socket is already open', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;

    client.send({ t: 'move:dir', dx: 1, dy: 0 });

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({ t: 'move:dir', dx: 1, dy: 0 });
  });

  it('refuses to send a message that fails schema validation, and never queues it', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // dx is typed as `number` but MoveDirSchema's own `.min(-1).max(1)` rejects
    // this at runtime - the case NetClient.send()'s validation exists to catch.
    client.send({ t: 'move:dir', dx: 5, dy: 0 });

    expect(socket.sent).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('NetClient: receiving', () => {
  it('dispatches a parsed, valid server message to every listener', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;

    const received: unknown[] = [];
    client.onMessage((m) => received.push(m));

    socket.receive(JSON.stringify({ t: 'system:announce', text: 'hello' }));

    expect(received).toEqual([{ t: 'system:announce', text: 'hello' }]);
  });

  it('drops a message that fails schema validation without throwing', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received: unknown[] = [];
    client.onMessage((m) => received.push(m));

    expect(() => socket.receive(JSON.stringify({ t: 'totally:fake' }))).not.toThrow();

    expect(received).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('drops non-JSON data without throwing', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => socket.receive('not json{{{')).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an unsubscribe function stops further delivery to that listener', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;
    const received: unknown[] = [];
    const unsubscribe = client.onMessage((m) => received.push(m));

    socket.receive(JSON.stringify({ t: 'system:announce', text: 'first' }));
    unsubscribe();
    socket.receive(JSON.stringify({ t: 'system:announce', text: 'second' }));

    expect(received).toEqual([{ t: 'system:announce', text: 'first' }]);
  });
});

describe('NetClient: closing', () => {
  it('notifies close listeners with the code and reason', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');
    socket.openNow();
    await connectPromise;
    const closes: Array<{ code: number; reason: string }> = [];
    client.onClose((e) => closes.push(e));

    socket.closeNow(4000, 'kicked');

    expect(closes).toEqual([{ code: 4000, reason: 'kicked' }]);
  });

  it('rejects the connect() promise if the socket closes before ever opening', async () => {
    const { socket, client } = makeClient();
    const connectPromise = client.connect('ws://test');

    socket.closeNow(1006, '');

    await expect(connectPromise).rejects.toThrow();
  });
});
