/**
 * Dev-mode chat commands (SPEC.md section 2: "Chat commands such as
 * `/level <n>`, `/joblevel <n>`, `/give <itemId> [qty]`, `/tp <mapId>`,
 * `/spawn <monsterId>` and `/boss <bossId>`... development mode only").
 *
 * This module only parses - sim/world.ts gates whether dev:command (and,
 * for convenience, a chat:send that starts with "/") is even looked at by
 * the TERAGO_DEV_TOOLS env flag, then executes the parsed command against
 * the Room/World it already has a reference to. Keeping parsing pure means
 * the whole command grammar is testable without a room, a repo, or a
 * player.
 */

export type DevCommand =
  | { kind: 'level'; n: number }
  | { kind: 'joblevel'; n: number }
  | { kind: 'give'; itemId: string; qty: number }
  | { kind: 'tp'; mapId: string }
  | { kind: 'spawn'; monsterId: string }
  | { kind: 'boss'; bossId: string }
  | { kind: 'unknown'; raw: string };

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Parses one line of dev-command input. Accepts the line with or without
 * its leading "/" (dev:command's own schema already strips it at the
 * message level in some clients, but chat:send text won't have). Returns
 * `{kind: 'unknown', raw: line}` for anything malformed rather than
 * throwing, so a typo in chat never takes down a connection. */
export function parseDevCommand(line: string): DevCommand {
  const trimmed = line.trim();
  const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const parts = body.split(/\s+/).filter((p) => p.length > 0);
  const [cmd, ...args] = parts;

  switch (cmd) {
    case 'level': {
      const n = args[0] !== undefined ? Number(args[0]) : NaN;
      return Number.isFinite(n) && n > 0 ? { kind: 'level', n: Math.floor(n) } : { kind: 'unknown', raw: line };
    }
    case 'joblevel': {
      const n = args[0] !== undefined ? Number(args[0]) : NaN;
      return Number.isFinite(n) && n > 0 ? { kind: 'joblevel', n: Math.floor(n) } : { kind: 'unknown', raw: line };
    }
    case 'give': {
      const itemId = args[0];
      if (!itemId) return { kind: 'unknown', raw: line };
      return { kind: 'give', itemId, qty: parsePositiveInt(args[1], 1) };
    }
    case 'tp': {
      const mapId = args[0];
      return mapId ? { kind: 'tp', mapId } : { kind: 'unknown', raw: line };
    }
    case 'spawn': {
      const monsterId = args[0];
      return monsterId ? { kind: 'spawn', monsterId } : { kind: 'unknown', raw: line };
    }
    case 'boss': {
      const bossId = args[0];
      return bossId ? { kind: 'boss', bossId } : { kind: 'unknown', raw: line };
    }
    default:
      return { kind: 'unknown', raw: line };
  }
}
