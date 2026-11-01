import type { FirstPersonController } from "../player/FirstPersonController";
import type { Hud } from "../ui/Hud";
import type { Office } from "../world/Office";
import { InterviewPanel } from "../ui/InterviewPanel";
import type { SceneManager } from "./SceneManager";

type OfficeInteraction = "door" | "light";

export class InteractionController {
  private readonly interviewPanel: InterviewPanel;

  constructor(
    private readonly scenes: SceneManager,
    private readonly world: Office,
    private readonly player: FirstPersonController,
    private readonly hud: Hud,
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly requestPointerLock: () => void,
    private readonly requestLightInteraction: () => boolean,
  ) {
    this.interviewPanel = new InterviewPanel(uiRoot, this.returnToOffice);
    this.scenes.office.onBeforeRenderObservable.add(this.update);
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    this.scenes.office.onBeforeRenderObservable.removeCallback(this.update);
    window.removeEventListener("keydown", this.onKeyDown);
    this.interviewPanel.dispose();
  }

  private getNearestInteraction(): OfficeInteraction | null {
    const player = this.player.camera.position;
    const targets = [
      { type: "door" as const, position: this.world.interviewDoorPosition, radius: 2.25 },
      { type: "light" as const, position: this.world.lightSwitchPosition, radius: 1.65 },
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
      this.hud.showPrompt("E — войти в кабинет для интервью");
    } else {
      this.hud.showPrompt(`E — ${this.world.isLightOn ? "выключить" : "включить"} свет`);
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

  private readonly returnToOffice = (): void => {
    if (!this.scenes.isInterviewActive || !this.interviewPanel.canExit) return;

    this.interviewPanel.setActive(false);
    this.scenes.returnToOffice();
    this.hud.setInterviewMode(false);
    this.hud.hidePrompt();
    this.requestPointerLock();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.code !== "KeyE") return;

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
    } else {
      if (!this.requestLightInteraction()) {
        this.hud.showError("Не удалось переключить свет. Проверьте подключение и попробуйте ещё раз.");
      }
    }
  };
}
