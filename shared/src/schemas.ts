/**
 * Every client<->server message for M1, as zod schemas. The server validates every
 * inbound message against ClientMessageSchema before touching game state (SPEC.md
 * section 2); nothing here is trusted until it parses.
 */
import { z } from 'zod';

export const StatNameSchema = z.enum(['STR', 'AGI', 'VIT', 'LUK', 'INT', 'DEX']);
export const EquipmentSlotSchema = z.enum(['weapon', 'helmet', 'chest', 'boots', 'wings']);
export const FacingSchema = z.enum(['down', 'up', 'left', 'right']);
export const ResourceKindSchema = z.enum(['stamina', 'momentum', 'mana', 'focus']);

export const TileCoordSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export const HotbarBindingSchema = z.union([
  z.object({ type: z.literal('skill'), id: z.string() }),
  z.object({ type: z.literal('item'), id: z.string() }),
  z.null(),
]);

// ================= client -> server =================

export const AuthRegisterSchema = z.object({
  t: z.literal('auth:register'),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscore only'),
  password: z.string().min(8).max(100),
});

export const AuthLoginSchema = z.object({
  t: z.literal('auth:login'),
  username: z.string().min(3).max(20),
  password: z.string().min(8).max(100),
});

export const MoveToSchema = z.object({
  t: z.literal('move:to'),
  target: TileCoordSchema,
});

export const MoveDirSchema = z.object({
  t: z.literal('move:dir'),
  dx: z.number().min(-1).max(1),
  dy: z.number().min(-1).max(1),
});

export const TargetSetSchema = z.object({
  t: z.literal('target:set'),
  entityId: z.string().nullable(),
});

export const HotbarUseSchema = z.object({
  t: z.literal('hotbar:use'),
  slot: z.number().int().min(1).max(8),
});

export const HotbarAssignSchema = z.object({
  t: z.literal('hotbar:assign'),
  slot: z.number().int().min(1).max(8),
  binding: HotbarBindingSchema,
});

export const EquipItemSchema = z.object({
  t: z.literal('equip:item'),
  itemInstanceId: z.string(),
});

export const UnequipSlotSchema = z.object({
  t: z.literal('unequip:slot'),
  slot: EquipmentSlotSchema,
});

export const StatAllocateSchema = z.object({
  t: z.literal('stat:allocate'),
  stat: StatNameSchema,
  points: z.number().int().min(1).max(100),
});

export const ChatSendSchema = z.object({
  t: z.literal('chat:send'),
  channel: z.enum(['global', 'map', 'system']),
  text: z.string().min(1).max(200),
});

export const MountToggleSchema = z.object({ t: z.literal('mount:toggle') });

export const AutoToggleSchema = z.object({
  t: z.literal('auto:toggle'),
  on: z.boolean(),
});

export const AutoConfigureSchema = z.object({
  t: z.literal('auto:configure'),
  autoTargetMobs: z.boolean(),
  autoUsePotionsHpPct: z.number().min(10).max(90).nullable(),
  autoUsePotionsResourcePct: z.number().min(10).max(90).nullable(),
  autoCastLowTierSkills: z.boolean(),
});

export const DevCommandSchema = z.object({
  t: z.literal('dev:command'),
  line: z.string().min(1).max(200),
});

/** Sent once, right after the client finishes playing the story intro
 * (section 4), so a later login can skip it (SPEC.md M1: "On later logins
 * the intro is skipped"). Replaying it from Settings is purely client-side
 * (just re-show the scene) and needs no message of its own. */
export const IntroSeenSchema = z.object({ t: z.literal('intro:seen') });

export const ClientMessageSchema = z.discriminatedUnion('t', [
  AuthRegisterSchema,
  AuthLoginSchema,
  MoveToSchema,
  MoveDirSchema,
  TargetSetSchema,
  HotbarUseSchema,
  HotbarAssignSchema,
  EquipItemSchema,
  UnequipSlotSchema,
  StatAllocateSchema,
  ChatSendSchema,
  MountToggleSchema,
  AutoToggleSchema,
  AutoConfigureSchema,
  DevCommandSchema,
  IntroSeenSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ================= server -> client =================

export const EntitySnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(['player', 'monster']),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  facing: FacingSchema,
  anim: z.enum(['idle', 'walk', 'attack', 'cast', 'hurt', 'death', 'wakeUp']),
  hpPct: z.number().min(0).max(100),
  equipment: z.record(EquipmentSlotSchema, z.string().nullable()).optional(),
  mounted: z.boolean().optional(),
});
export type EntitySnapshot = z.infer<typeof EntitySnapshotSchema>;

export const WorldSnapshotSchema = z.object({
  t: z.literal('world:snapshot'),
  tick: z.number().int(),
  entered: z.array(EntitySnapshotSchema),
  updated: z.array(EntitySnapshotSchema),
  left: z.array(z.string()),
});

export const SelfStateSchema = z.object({
  t: z.literal('self:state'),
  characterId: z.string(),
  name: z.string(),
  baseLevel: z.number().int(),
  jobLevel: z.number().int(),
  jobId: z.string(),
  baseExp: z.number().int(),
  baseExpToNext: z.number().int(),
  jobExp: z.number().int(),
  jobExpToNext: z.number().int(),
  stats: z.record(StatNameSchema, z.number().int()),
  unallocatedStatPoints: z.number().int(),
  introSeen: z.boolean(),
  hp: z.number().int(),
  maxHp: z.number().int(),
  resource: z.number().int(),
  maxResource: z.number().int(),
  resourceKind: ResourceKindSchema,
  equipment: z.record(EquipmentSlotSchema, z.string().nullable()),
  hotbar: z.array(
    z.union([
      z.object({ type: z.literal('skill'), id: z.string() }),
      z.object({ type: z.literal('item'), id: z.string(), qty: z.number().int() }),
      z.null(),
    ])
  ).length(8),
});

export const CombatResultSchema = z.object({
  t: z.literal('combat:result'),
  attackerId: z.string(),
  defenderId: z.string(),
  outcome: z.enum(['perfectDodge', 'miss', 'hit', 'crit']),
  damage: z.number().int().optional(),
});

export const ChatMessageSchema = z.object({
  t: z.literal('chat:message'),
  channel: z.enum(['global', 'map', 'system', 'monster', 'pet', 'npc']),
  speaker: z.string(),
  text: z.string(),
});

export const SystemAnnounceSchema = z.object({
  t: z.literal('system:announce'),
  text: z.string(),
});

export const QuestUpdateSchema = z.object({
  t: z.literal('quest:update'),
  questId: z.string(),
  state: z.enum(['notStarted', 'active', 'readyToTurnIn', 'complete']),
  objectiveProgress: z.record(z.string(), z.number()),
});

export const AuthResultSchema = z.object({
  t: z.literal('auth:result'),
  ok: z.boolean(),
  error: z.string().optional(),
  sessionToken: z.string().optional(),
});

export const ServerMessageSchema = z.discriminatedUnion('t', [
  WorldSnapshotSchema,
  SelfStateSchema,
  CombatResultSchema,
  ChatMessageSchema,
  SystemAnnounceSchema,
  QuestUpdateSchema,
  AuthResultSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
