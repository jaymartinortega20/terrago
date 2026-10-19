import type { Pool } from '../db';
import type { Logger } from '../logger';

interface Entry {
  channel: 'local';
  mapId: string;
  senderId: string;
  body: string;
}

/**
 * Chat is logged for moderation/reports, but never on the hot path: messages
 * are buffered and written in batches.
 */
export class ChatLog {
  private buffer: Entry[] = [];
  private timer: NodeJS.Timeout;

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
    intervalMs = 2000,
  ) {
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref();
  }

  add(e: Entry): void {
    this.buffer.push(e);
    if (this.buffer.length >= 500) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.pool.query(
        `INSERT INTO messages (channel, map_id, sender_character_id, body)
         SELECT * FROM unnest($1::text[], $2::text[], $3::uuid[], $4::text[])`,
        [batch.map((b) => b.channel), batch.map((b) => b.mapId), batch.map((b) => b.senderId), batch.map((b) => b.body)],
      );
    } catch (err) {
      this.log.error('chat_log_flush_failed', { err, count: batch.length });
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
