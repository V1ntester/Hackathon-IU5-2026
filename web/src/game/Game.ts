import { Color4, Engine, Scene, Vector3 } from "@babylonjs/core";
import { FirstPersonController } from "../player/FirstPersonController";
import { Hud } from "../ui/Hud";
import { Office } from "../world/Office";
import { InterviewRoom } from "../world/InterviewRoom";
import { GameClient } from "../network/GameClient";
import { RemotePlayers } from "../world/RemotePlayers";
import { OnlinePanel } from "../ui/OnlinePanel";
import { SceneManager } from "./SceneManager";
import { InteractionController } from "./InteractionController";

export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly world: Office;
  readonly interview: InterviewRoom;
  readonly player: FirstPersonController;
  readonly hud: Hud;
  readonly network: GameClient;
  readonly remotePlayers: RemotePlayers;
  readonly online: OnlinePanel;
  readonly scenes: SceneManager;

  private readonly canvas: HTMLCanvasElement;
  private readonly interactions: InteractionController;
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
    void this.world.npcs.init(this.player.camera);
    this.interview = new InterviewRoom(this.engine);
    this.hud = new Hud(uiRoot, this.requestPointerLock);
    this.remotePlayers = new RemotePlayers(this.scene);
    this.online = new OnlinePanel(uiRoot);
    this.network = new GameClient({
      status: (message) => this.online.setStatus(message),
      state: (players, localId) => {
        this.remotePlayers.sync(players, localId);
        this.online.setPlayerCount(players.length);
      },
      objects: (objects) => {
        const light = objects.find((object) => object.id === "office-light");
        if (light) this.world.setLightEnabled(light.state === "active");
      },
      event: (event) => {
        if (event.name === "command_rejected" && event.payload.object_id === "office-light") {
          this.hud.showError("Сервер отклонил переключение света.");
        }
      },
      connected: () => this.sendPosition(),
    });
    this.scenes = new SceneManager(this.engine, this.scene, this.interview, this.player);
    this.interactions = new InteractionController(
      this.scenes,
      this.world,
      this.player,
      this.hud,
      canvas,
      uiRoot,
      this.requestPointerLock,
      () => this.network.sendInteract("office-light"),
    );

    // Интервал выше 50 мс: сервер ограничивает частоту принятых перемещений.
    this.movementTimer = setInterval(this.sendPosition, 80);
    void this.network.connect();

    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onPointerLockError);
    window.addEventListener("resize", this.onResize);
    this.scenes.start();
  }

  dispose(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onPointerLockError);
    window.removeEventListener("resize", this.onResize);

    clearInterval(this.movementTimer);
    this.interactions.dispose();
    this.network.dispose();
    this.remotePlayers.dispose();
    this.online.dispose();
    this.scenes.dispose();
    this.player.dispose();
    this.hud.dispose();
    this.interview.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly requestPointerLock = (): void => {
    if (this.scenes.isInterviewActive) return;
    if (document.pointerLockElement === this.canvas) return;

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
    if (this.scenes.isInterviewActive) {
      this.player.setEnabled(false);
      return;
    }

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

  private readonly sendPosition = (): void => {
    if (this.scenes.isInterviewActive) return;
    const { x, y, z } = this.player.camera.position;
    this.network.sendMove({ x, y, z }, this.player.camera.rotation.y);
  };
}
