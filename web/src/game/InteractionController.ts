import type { FirstPersonController } from "../player/FirstPersonController";
import type { Hud } from "../ui/Hud";
import type { Office } from "../world/Office";
import { InterviewPanel } from "../ui/InterviewPanel";
import { NpcDialogPanel } from "../ui/NpcDialogPanel";
import type { SceneManager } from "./SceneManager";
import type { GameClient } from "../network/GameClient";

type OfficeInteraction = "door" | "light" | "npc";

export class InteractionController {
  private readonly interviewPanel: InterviewPanel;
  private readonly npcDialog: NpcDialogPanel;

  constructor(
    private readonly scenes: SceneManager,
    private readonly world: Office,
    private readonly player: FirstPersonController,
    private readonly hud: Hud,
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly requestPointerLock: () => void,
    private readonly requestLightInteraction: () => boolean,
    client: GameClient,
  ) {
    this.interviewPanel = new InterviewPanel(uiRoot, this.returnToOffice);
    this.npcDialog = new NpcDialogPanel(uiRoot, this.closeConversation);
    this.scenes.office.onBeforeRenderObservable.add(this.update);
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    this.scenes.office.onBeforeRenderObservable.removeCallback(this.update);
    window.removeEventListener("keydown", this.onKeyDown);
    this.interviewPanel.dispose();
    this.npcDialog.dispose();
  }

  setConnected(connected: boolean): void {
    this.interviewPanel.setConnected(connected);
  }

  setConnected(connected: boolean): void {
    this.interviewPanel.setConnected(connected);
  }

  private getNearestInteraction(): OfficeInteraction | null {
    const player = this.player.camera.position;
    const targets = [
      { type: "door" as const, position: this.world.interviewDoorPosition, radius: 2.25 },
      { type: "light" as const, position: this.world.lightSwitchPosition, radius: 1.65 },
      { type: "npc" as const, position: this.world.npcs.conversationPosition, radius: 2.6 },
    ];
    let nearest: OfficeInteraction | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const target of targets) {
      const distance = (target.position.x - player.x) ** 2 + (target.position.z - player.z) ** 2;
      if (distance <= target.radius ** 2 && distance < nearestDistance) {
        nearest = target.type;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private showOfficePrompt(interaction: OfficeInteraction): void {
    if (interaction === "door") {
      this.hud.showPrompt("E — Войти в кабинет для интервью");
    } else if (interaction === "npc") {
      this.hud.showPrompt("E — Поговорить с NPC");
    } else {
      this.hud.showPrompt(`E — ${this.world.isLightOn ? "Выключить" : "Включить"} свет`);
    }
  }

  private readonly update = (): void => {
    if (this.scenes.isInterviewActive) return;
    const interaction = document.pointerLockElement === this.canvas
      ? this.getNearestInteraction()
      : null;
    if (interaction) {
      this.showOfficePrompt(interaction);
    } else {
      this.hud.hidePrompt();
    }
  };

  private enterInterview(): void {
    if (this.scenes.isInterviewActive) return;

    this.scenes.enterInterview();
    this.hud.setInterviewMode(true);
    this.hud.hidePrompt();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.interviewPanel.setActive(true);
  }

  private openConversation(): void {
    this.world.npcs.startConversation();
    this.player.setEnabled(false);
    this.hud.setConversationOpen(true);
    this.hud.hidePrompt();
    this.npcDialog.setActive(true);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private readonly closeConversation = (): void => {
    if (!this.npcDialog.isOpen) return;

    this.npcDialog.setActive(false);
    this.hud.setConversationOpen(false);
    this.requestPointerLock();
  };

  private readonly returnToOffice = (): void => {
    if (!this.scenes.isInterviewActive || !this.interviewPanel.canExit) return;

    this.interviewPanel.setActive(false);
    this.scenes.returnToOffice();
    this.hud.setInterviewMode(false);
    this.hud.hidePrompt();
    this.requestPointerLock();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (this.npcDialog.isOpen) {
      if (event.code === "Escape") {
        event.preventDefault();
        this.closeConversation();
      }
      return;
    }
    if (event.code !== "KeyE") return;

    if (this.scenes.isInterviewActive) {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
      if (this.interviewPanel.canExit) {
        event.preventDefault();
        this.returnToOffice();
      }
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button")) return;
    if (document.pointerLockElement !== this.canvas) return;

    const interaction = this.getNearestInteraction();
    if (!interaction) return;
    event.preventDefault();
    if (interaction === "door") {
      this.enterInterview();
    } else if (interaction === "npc") {
      this.openConversation();
    } else if (!this.requestLightInteraction()) {
      this.hud.showError("Не удалось переключить свет. Проверьте подключение и попробуйте ещё раз.");
    }
  };
}
