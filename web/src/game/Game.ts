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

export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly world: Office;
  readonly player: FirstPersonController;
  readonly hud: Hud;

  private readonly canvas: HTMLCanvasElement;

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

    this.setupRenderPipeline();

    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onPointerLockError);
    window.addEventListener("resize", this.onResize);

    this.engine.runRenderLoop(() => this.scene.render());
  }

  dispose(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onPointerLockError);
    window.removeEventListener("resize", this.onResize);

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
    this.player.setEnabled(locked);
    this.hud.setPlaying(locked);
  };

  private readonly onPointerLockError = (): void => {
    this.hud.showError("Не удалось захватить курсор. Проверьте разрешения браузера.");
  };

  private readonly onResize = (): void => {
    this.engine.resize();
  };
}
