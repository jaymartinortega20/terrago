/**
 * The single source of truth both Phaser scenes and the DOM HUD read from.
 * Neither side owns the data - WorldScene and the ui/ modules are both
 * just subscribers that render whatever's in here. Keeping this framework-
 * agnostic (no Phaser, no DOM) is what lets it be unit tested directly.
 */
import type { EntitySnapshot, ServerMessage } from '@terago/shared';

export type SelfState = Extract<ServerMessage, { t: 'self:state' }>;
export type QuestUpdate = Extract<ServerMessage, { t: 'quest:update' }>;
export type ChatMessage = Extract<ServerMessage, { t: 'chat:message' }>;
export type CombatResult = Extract<ServerMessage, { t: 'combat:result' }>;

export interface QuestTrackerEntry {
  questId: string;
  state: QuestUpdate['state'];
  objectiveProgress: Record<string, number>;
}

type Listener<T> = (value: T) => void;

/** A tiny typed pub/sub - deliberately smaller than a general EventEmitter
 * since every event here has exactly one payload shape. */
class Signal<T> {
  private readonly listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}

export class GameState {
  self: SelfState | null = null;
  /** Every entity currently inside the local player's area of interest,
   * keyed by entity id (character id or monster instance id) - fed by
   * world:snapshot's entered/updated/left. */
  readonly entities = new Map<string, EntitySnapshot>();
  readonly quests = new Map<string, QuestTrackerEntry>();
  readonly chatLog: ChatMessage[] = [];
  mapId: string | null = null;

  readonly onSelfState = new Signal<SelfState>();
  readonly onEntityEntered = new Signal<EntitySnapshot>();
  readonly onEntityUpdated = new Signal<EntitySnapshot>();
  readonly onEntityLeft = new Signal<string>();
  readonly onQuestUpdate = new Signal<QuestUpdate>();
  readonly onChatMessage = new Signal<ChatMessage>();
  readonly onCombatResult = new Signal<CombatResult>();
  readonly onAuthResult = new Signal<Extract<ServerMessage, { t: 'auth:result' }>>();
  readonly onSystemAnnounce = new Signal<Extract<ServerMessage, { t: 'system:announce' }>>();

  /** The single entry point every incoming ServerMessage flows through -
   * updates this store's own state, then re-emits as a typed signal so
   * anything downstream (HUD panels, Phaser scenes) can react without each
   * one re-parsing the raw message. */
  handleServerMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'self:state':
        this.self = message;
        this.onSelfState.emit(message);
        break;
      case 'world:snapshot':
        for (const snapshot of message.entered) {
          this.entities.set(snapshot.id, snapshot);
          this.onEntityEntered.emit(snapshot);
        }
        for (const snapshot of message.updated) {
          this.entities.set(snapshot.id, snapshot);
          this.onEntityUpdated.emit(snapshot);
        }
        for (const id of message.left) {
          this.entities.delete(id);
          this.onEntityLeft.emit(id);
        }
        break;
      case 'quest:update':
        this.quests.set(message.questId, {
          questId: message.questId,
          state: message.state,
          objectiveProgress: message.objectiveProgress,
        });
        this.onQuestUpdate.emit(message);
        break;
      case 'chat:message':
        this.chatLog.push(message);
        this.onChatMessage.emit(message);
        break;
      case 'combat:result':
        this.onCombatResult.emit(message);
        break;
      case 'auth:result':
        this.onAuthResult.emit(message);
        break;
      case 'system:announce':
        this.onSystemAnnounce.emit(message);
        break;
    }
  }

  /** The local player's own entity, if it's currently in view - true once
   * joined, since a player is always inside their own area of interest. */
  localEntity(): EntitySnapshot | undefined {
    return this.self ? this.entities.get(this.self.characterId) : undefined;
  }

  reset(): void {
    this.self = null;
    this.entities.clear();
    this.quests.clear();
    this.chatLog.length = 0;
    this.mapId = null;
  }
}
