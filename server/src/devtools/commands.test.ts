import { describe, expect, it } from 'vitest';
import { parseDevCommand } from './commands.js';

describe('parseDevCommand', () => {
  it('parses every command, with or without the leading slash', () => {
    expect(parseDevCommand('/level 42')).toEqual({ kind: 'level', n: 42 });
    expect(parseDevCommand('level 42')).toEqual({ kind: 'level', n: 42 });
    expect(parseDevCommand('/joblevel 7')).toEqual({ kind: 'joblevel', n: 7 });
    expect(parseDevCommand('/give potion_hp_small 10')).toEqual({ kind: 'give', itemId: 'potion_hp_small', qty: 10 });
    expect(parseDevCommand('/tp map2')).toEqual({ kind: 'tp', mapId: 'map2' });
    expect(parseDevCommand('/spawn slime')).toEqual({ kind: 'spawn', monsterId: 'slime' });
    expect(parseDevCommand('/boss infernal_caldera')).toEqual({ kind: 'boss', bossId: 'infernal_caldera' });
  });

  it('defaults /give qty to 1 when omitted', () => {
    expect(parseDevCommand('/give potion_hp_small')).toEqual({ kind: 'give', itemId: 'potion_hp_small', qty: 1 });
  });

  it('ignores extra whitespace', () => {
    expect(parseDevCommand('  /level   5  ')).toEqual({ kind: 'level', n: 5 });
  });

  it('falls back to unknown for a non-numeric or missing /level argument', () => {
    expect(parseDevCommand('/level')).toEqual({ kind: 'unknown', raw: '/level' });
    expect(parseDevCommand('/level abc')).toEqual({ kind: 'unknown', raw: '/level abc' });
    expect(parseDevCommand('/level -5')).toEqual({ kind: 'unknown', raw: '/level -5' });
  });

  it('falls back to unknown for a missing /give item id', () => {
    expect(parseDevCommand('/give')).toEqual({ kind: 'unknown', raw: '/give' });
  });

  it('falls back to unknown for an unrecognized command', () => {
    expect(parseDevCommand('/nonsense foo')).toEqual({ kind: 'unknown', raw: '/nonsense foo' });
  });

  it('falls back to unknown for an empty line', () => {
    expect(parseDevCommand('')).toEqual({ kind: 'unknown', raw: '' });
    expect(parseDevCommand('   ')).toEqual({ kind: 'unknown', raw: '   ' });
  });

  it('treats a non-finite /give qty as 1 rather than rejecting the command', () => {
    expect(parseDevCommand('/give slime_gel abc')).toEqual({ kind: 'give', itemId: 'slime_gel', qty: 1 });
  });
});
