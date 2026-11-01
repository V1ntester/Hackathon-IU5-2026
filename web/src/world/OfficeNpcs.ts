import {
  ImportMeshAsync,
  Mesh,
  TransformNode,
  Vector3,
  type AnimationGroup,
  type Scene,
  type ShadowGenerator,
  type UniversalCamera,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { ASSETS_URL } from "../game/config";

interface OfficeNpc {
  root: TransformNode;
  animations: AnimationGroup[];
}

function playAnimation(animations: AnimationGroup[], name: string): void {
  for (const animation of animations) animation.stop();
  const animation = animations.find((candidate) => candidate.name === name);
  if (animation) {
    animation.start(true);
  } else {
    console.warn(`Анимация ${name} не найдена у NPC.`);
  }
}

function yawToward(position: Vector3, target: Vector3): number {
  return Math.atan2(target.z - position.z, position.x - target.x);
}

export class OfficeNpcs {
  readonly conversationPosition = new Vector3(0, 0, 10);

  private camera: UniversalCamera | null = null;
  private greeter: OfficeNpc | null = null;
  private watchers: OfficeNpc[] = [];
  private conversationStarted = false;

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.scene.onBeforeRenderObservable.add(this.update);
  }

  async init(camera: UniversalCamera): Promise<void> {
    if (this.camera) return;
    this.camera = camera;

    const crowdCenter = new Vector3(8, 0, 8);
    const greeterPromise = this.loadNpc(
      "officeGreeter",
      this.conversationPosition,
      Vector3.Zero(),
      "Greetings",
    );
    const watcherPromises = [
      new Vector3(-8.5, 0, 8.5),
      new Vector3(-7.5, 0, 9.5),
    ].map((position, index) => this.loadNpc(
      `officeWatcher${index + 1}`,
      position,
      camera.position,
      "Idle1",
    ));
    const crowdPromises = Array.from({ length: 4 }, (_, index) => {
      const angle = index * Math.PI / 2;
      const position = new Vector3(
        crowdCenter.x + Math.cos(angle) * 1.3,
        0,
        crowdCenter.z + Math.sin(angle) * 1.3,
      );
      return this.loadNpc(`officeCrowd${index + 1}`, position, crowdCenter, "Idle1");
    });

    this.greeter = await greeterPromise;
    if (this.conversationStarted && this.greeter) {
      playAnimation(this.greeter.animations, "Idle1");
    }
    this.watchers = (await Promise.all(watcherPromises)).filter(
      (npc): npc is OfficeNpc => npc !== null,
    );
    await Promise.all(crowdPromises);
  }

  startConversation(): void {
    this.conversationStarted = true;
    if (this.greeter) playAnimation(this.greeter.animations, "Idle1");
  }

  private readonly update = (): void => {
    if (!this.camera) return;
    for (const watcher of this.watchers) {
      watcher.root.rotation.y = yawToward(watcher.root.position, this.camera.position);
    }
  };

  private async loadNpc(
    name: string,
    position: Vector3,
    lookAt: Vector3,
    animationName: string,
  ): Promise<OfficeNpc | null> {
    try {
      const result = await ImportMeshAsync("employee_stickman.glb", this.scene, {
        rootUrl: ASSETS_URL,
      });
      const model = result.meshes[0];
      if (!model) return null;

      const root = new TransformNode(name, this.scene);
      root.position = position.clone();
      root.rotation.y = yawToward(position, lookAt);
      root.scaling.setAll(1.25);
      model.parent = root;

      for (const mesh of result.meshes) {
        if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
          this.shadows.addShadowCaster(mesh);
        }
      }
      playAnimation(result.animationGroups, animationName);
      return { root, animations: result.animationGroups };
    } catch (error) {
      console.error(`Не удалось загрузить NPC ${name}:`, error);
      return null;
    }
  }
}
