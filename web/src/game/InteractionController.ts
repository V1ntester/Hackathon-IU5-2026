import type { FirstPersonController } from "../player/FirstPersonController";
import type { Hud } from "../ui/Hud";
import type { Office } from "../world/Office";
import { InterviewPanel } from "../ui/InterviewPanel";
import type { SceneManager } from "./SceneManager";

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

  private isNearDoor(): boolean {
    const door = this.world.interviewDoorPosition;
    const player = this.player.camera.position;
    return (door.x - player.x) ** 2 + (door.z - player.z) ** 2 <= 2.25 ** 2;
  }

  private readonly update = (): void => {
    if (this.scenes.isInterviewActive) return;
    if (document.pointerLockElement !== this.canvas || !this.isNearDoor()) {
      this.hud.hidePrompt();
      return;
    }
    this.hud.showPrompt("E — войти в кабинет для интервью");
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
    if (document.pointerLockElement !== this.canvas || !this.isNearDoor()) return;

    event.preventDefault();
    this.enterInterview();
  };
}
