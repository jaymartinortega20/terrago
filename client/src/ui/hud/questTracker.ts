/**
 * SPEC.md section 7/5: "Quest tracker (right edge)... the active quest and
 * its objective progress... show in the quest tracker." M1 only ever has
 * one quest active at a time (the chain is linear: First Steps -> Cleaning
 * the Horizon), but this renders every non-terminal entry in
 * GameState.quests rather than assuming exactly one, so it degrades
 * gracefully if that ever changes.
 */
import type { QuestTrackerEntry } from '../../state/GameState.js';
import { objectiveLabel, objectivesFor, questDisplayName } from './questLabels.js';

export class QuestTracker {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-quest';
    this.root.innerHTML = `<h3>Quests</h3><div class="terago-quest-list"></div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.terago-quest-list')!;
  }

  update(quests: ReadonlyMap<string, QuestTrackerEntry>): void {
    const active = [...quests.values()].filter((q) => q.state === 'active' || q.state === 'readyToTurnIn');
    this.root.style.display = active.length > 0 ? '' : 'none';
    if (active.length === 0) return;

    this.list.innerHTML = active
      .map((quest) => {
        const objectives = objectivesFor(quest.questId)
          .map((obj) => {
            const progress = Math.min(quest.objectiveProgress[obj.id] ?? 0, obj.count);
            return `<div class="terago-quest-objective">${objectiveLabel(obj)} <span>${progress}/${obj.count}</span></div>`;
          })
          .join('');
        const readyBadge = quest.state === 'readyToTurnIn' ? '<span class="terago-quest-ready">Ready to turn in!</span>' : '';
        return `<div class="terago-quest-entry"><div class="terago-quest-name">${questDisplayName(quest.questId)}</div>${objectives}${readyBadge}</div>`;
      })
      .join('');
  }

  destroy(): void {
    this.root.remove();
  }
}
