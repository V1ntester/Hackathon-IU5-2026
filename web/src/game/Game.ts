import {
  Color4,
  DefaultRenderingPipeline,
  Engine,
  ImageProcessingConfiguration,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { FirstPersonController } from "../player/FirstPersonController";
import { Hud } from "../ui/Hud";
import { Office } from "../world/Office";
import { GameClient } from "../network/GameClient";
import { RemotePlayers } from "../world/RemotePlayers";
import { OnlinePanel } from "../ui/OnlinePanel";

export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly world: Office;
  readonly player: FirstPersonController;
  readonly hud: Hud;
  readonly network: GameClient;
  readonly remotePlayers: RemotePlayers;
  readonly online: OnlinePanel;

  private readonly canvas: HTMLCanvasElement;
  private readonly movementTimer: ReturnType<typeof setInterval>;
  private npcNearby = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;

    this.engine = new Engine(
      canvas,
      true,
      {
        preserveDrawingBuffer: true,
        stencil: true,
        powerPreference: "high-performance",
      },
      true,
    );

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.04, 0.055, 0.075, 1);
    this.scene.collisionsEnabled = true;
    // Гравитация Babylon задаётся в единицах на кадр; игрок всегда стоит на полу.
    this.scene.gravity = new Vector3(0, -0.35, 0);

    this.world = new Office(this.scene);
    this.player = new FirstPersonController(this.scene, canvas, this.world.spawn);
    this.hud = new Hud(uiRoot, this.requestPointerLock);
    this.remotePlayers = new RemotePlayers(this.scene);
    this.network = new GameClient({
      status: (message, connected) => this.online.setStatus(message, connected),
      state: (players, localId) => {
        this.remotePlayers.sync(players, localId);
        this.online.setPlayerCount(players.length);
      },
      connected: () => {
        this.sendPosition();
        void this.online.loadScenarios();
      },
    });
    this.online = new OnlinePanel(uiRoot, this.network, () => this.setNpcOpen(false));
    // Интервал выше 50 мс: сервер ограничивает частоту принятых перемещений.
    this.movementTimer = setInterval(this.sendPosition, 80);
    void this.network.connect();

    this.scene.onBeforeRenderObservable.add(this.checkNpcProximity);

    this.setupRenderPipeline();

    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onPointerLockError);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onInteractionKey);

    this.engine.runRenderLoop(() => this.scene.render());
  }

  dispose(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onPointerLockError);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onInteractionKey);

    clearInterval(this.movementTimer);
    this.scene.onBeforeRenderObservable.removeCallback(this.checkNpcProximity);
    this.network.dispose();
    this.remotePlayers.dispose();
    this.online.dispose();
    this.engine.stopRenderLoop();
    this.player.dispose();
    this.hud.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private setupRenderPipeline(): void {
    const pipeline = new DefaultRenderingPipeline("officePipeline", true, this.scene, [
      this.player.camera,
    ]);

    pipeline.samples = 4;
    pipeline.fxaaEnabled = true;

    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.8;
    pipeline.bloomWeight = 0.22;
    pipeline.bloomKernel = 48;
    pipeline.bloomScale = 0.5;

    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.exposure = 1.1;
    pipeline.imageProcessing.contrast = 1.03;

    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.4;
    pipeline.imageProcessing.vignetteStretch = 0.5;
  }

  private readonly requestPointerLock = (): void => {
    if (this.online.isOpen) return;
    if (document.pointerLockElement === this.canvas) {
      return;
    }

    try {
      const request = this.canvas.requestPointerLock() as unknown;
      if (request instanceof Promise) {
        request.catch(() => {
          this.hud.showError("Браузер не разрешил захват курсора. Попробуйте кликнуть ещё раз.");
        });
      }
    } catch {
      this.hud.showError("Не удалось захватить курсор мыши.");
    }
  };

  private readonly onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.player.setEnabled(locked && !this.online.isOpen);
    this.hud.setPlaying(locked);
  };

  private readonly onPointerLockError = (): void => {
    this.hud.showError("Не удалось захватить курсор. Проверьте разрешения браузера.");
  };

  private readonly onResize = (): void => {
    this.engine.resize();
  };

  private readonly sendPosition = (): void => {
    const { x, y, z } = this.player.camera.position;
    this.network.sendMove({ x, y, z }, this.player.camera.rotation.y);
  };

  private setNpcOpen(open: boolean): void {
    this.online.setOpen(open);
    this.hud.setInteractionOpen(open);
    if (open) {
      this.player.setEnabled(false);
      this.hud.hidePrompt();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  }

  private isNearNpc(): boolean {
    const npc = this.world.npc;
    if (!npc || npc.isDisposed()) return false;
    const position = npc.getAbsolutePosition();
    const player = this.player.camera.position;
    // Расстояние по полу: камера находится на высоте глаз, корень NPC — у стоп.
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= 3 ** 2;
  }

  private readonly checkNpcProximity = (): void => {
    if (!this.isNearNpc()) {
      this.npcNearby = false;
      this.hud.hidePrompt();
      return;
    }
    if (document.pointerLockElement !== this.canvas || this.online.isOpen) {
      this.hud.hidePrompt();
      return;
    }
    if (!this.npcNearby) {
      this.npcNearby = true;
      this.setNpcOpen(true);
      return;
    }
    this.hud.showPrompt("E — снова поговорить с NPC");
  };

  private readonly onInteractionKey = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === "Escape" && this.online.isOpen) {
      this.setNpcOpen(false);
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button")) return;
    if (event.code === "KeyE" && document.pointerLockElement === this.canvas && this.isNearNpc()) {
      event.preventDefault();
      this.npcNearby = true;
      this.setNpcOpen(true);
    }
  };
}
