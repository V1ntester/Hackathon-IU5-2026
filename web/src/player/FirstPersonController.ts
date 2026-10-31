import { Scene, AbstractMesh, UniversalCamera, Vector3 } from "@babylonjs/core";
import { PLAYER, SPAWN } from "../game/config";

/**
 * Контроллер от первого лица: плавное ускорение, бег, покачивание камеры.
 * Babylon отвечает за коллизии и «прилипание» к полу через гравитацию.
 */
export class FirstPersonController {
  readonly camera: UniversalCamera;

  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private readonly velocity = new Vector3();
  private readonly baseFov = PLAYER.fov;

  private active = false;

  private currentInteractable: AbstractMesh | null = null;

  constructor(scene: Scene, canvas: HTMLCanvasElement, spawn: Vector3) {
    this.scene = scene;
    this.canvas = canvas;

    this.camera = new UniversalCamera("playerCamera", spawn.clone(), scene);
    this.camera.rotation = new Vector3(0, SPAWN.yaw, 0);
    this.camera.fov = this.baseFov;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 500;
    this.camera.angularSensibility = PLAYER.lookSensitivity;
    this.camera.inertia = 0.4;

    // Коллайдер — эллипсоид, низ которого стоит ровно на полу.
    // Babylon строит центр как position - ellipsoid.y + ellipsoidOffset,
    // поэтому при eyeHeight = 2 * halfHeight смещение не нужно.
    this.camera.checkCollisions = true;
    this.camera.applyGravity = true;
    this.camera.needMoveForGravity = true;
    this.camera.ellipsoid = new Vector3(
      PLAYER.collisionRadius,
      PLAYER.collisionHalfHeight,
      PLAYER.collisionRadius,
    );
    this.camera.ellipsoidOffset = Vector3.Zero();

    // WASD обрабатываем сами, встроенное управление камерой оставляем только мыши.
    this.camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
    this.camera.inputs.removeByType("FreeCameraTouchInput");

    scene.activeCamera = this.camera;
    scene.onBeforeRenderObservable.add(this.update);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
  }

  setEnabled(enabled: boolean): void {
    if (this.active === enabled) {
      return;
    }
    this.active = enabled;

    if (enabled) {
      this.camera.attachControl(this.canvas, true);
      this.canvas.focus({ preventScroll: true });
      return;
    }

    this.keys.clear();
    this.velocity.setAll(0);
    this.camera.cameraDirection.setAll(0);
    this.camera.detachControl();
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    this.camera.dispose();
  }

  setupInteraction(scene: Scene, hud: any) { // hud — ваш класс для интерфейса
      scene.onBeforeRenderObservable.add(() => {
          const camera = scene.activeCamera;
          if (!camera) return;

          // Создаем луч из камеры вперед на расстояние 3 метра (дистанция взаимодействия)
          const ray = camera.getForwardRay(3); 
          
          // Пускаем луч в сцену (фильтруем только те меши, у которых есть metadata.interactable)
          const hit = scene.pickWithRay(ray, (mesh) => {
              return mesh.metadata?.interactable === true;
          });

          if (hit && hit.hit && hit.pickedMesh) {
              this.currentInteractable = hit.pickedMesh;
              // Показываем надпись на экране
              hud.showPrompt("Нажмите E");
          } else {
              this.currentInteractable = null;
              // Скрываем надпись
              hud.hidePrompt();
          }
      });

      // Слушатель нажатия клавиши E
      window.addEventListener("keydown", (event) => {
          if (event.code === "KeyE" && this.currentInteractable) {
              const action = this.currentInteractable.metadata?.action;
              if (action === "Start Conversation") {
                  console.log("Действие: Начинаем диалог!");
              }
          }
      });
  }

  private readonly update = (): void => {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);

    if (!this.active) {
      this.camera.cameraDirection.setAll(0);
      return;
    }

    let forwardInput = 0;
    let strafeInput = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forwardInput += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forwardInput -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafeInput += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafeInput -= 1;

    const forward = this.camera.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) {
      forward.set(0, 0, 1);
    } else {
      forward.normalize();
    }
    const right = Vector3.Cross(Vector3.Up(), forward);

    const wish = forward.scale(forwardInput).addInPlace(right.scale(strafeInput));
    const hasInput = wish.lengthSquared() > 1e-6;

    const sprinting =
      this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const targetSpeed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    if (hasInput) {
      wish.normalize().scaleInPlace(targetSpeed);
    }

    const blend = 1 - Math.exp(-(hasInput ? PLAYER.acceleration : PLAYER.deceleration) * dt);
    this.velocity.x += (wish.x - this.velocity.x) * blend;
    this.velocity.z += (wish.z - this.velocity.z) * blend;

    // cameraDirection — это смещение ровно на один кадр, а не скорость:
    // Babylon сам умножает его на inertia и не обнуляет. Поэтому перезаписываем
    // значение, иначе смещения накапливаются и персонаж разгоняется в разы.
    this.camera.cameraDirection.copyFromFloats(this.velocity.x * dt, 0, this.velocity.z * dt);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const isMoving = speed > 0.15;

    const targetFov = this.baseFov + (sprinting && isMoving ? 0.04 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-8 * dt));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onWindowBlur = (): void => {
    this.keys.clear();
    this.velocity.setAll(0);
    this.camera.cameraDirection.setAll(0);
    this.camera.rotation.z = 0;
  };
}
