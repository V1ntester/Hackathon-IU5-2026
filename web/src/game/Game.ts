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
    this.online = new OnlinePanel(uiRoot, this.network, this.toggleNpc);
    // Интервал выше 50 мс: сервер ограничивает частоту принятых перемещений.
    this.movementTimer = setInterval(this.sendPosition, 80);
    void this.network.connect();

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

  private readonly toggleNpc = (): void => {
    const open = !this.online.isOpen;
    this.online.setOpen(open);
    this.hud.setInteractionOpen(open);
    if (open) {
      this.player.setEnabled(false);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  };

  private readonly onInteractionKey = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === "Escape" && this.online.isOpen) {
      this.toggleNpc();
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button")) return;
    if (event.code === "KeyE") {
      event.preventDefault();
      this.toggleNpc();
    }
  };
}
