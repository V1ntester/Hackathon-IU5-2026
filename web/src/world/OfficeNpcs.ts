import {
  ImportMeshAsync,
  Color3,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
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
  private readonly jokes: Mesh[] = [];
  private jokeTime = 0;
  private jokeActive = false;
  private jokeCompleted = false;

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
    this.createJoke();
    await Promise.all(crowdPromises);
  }

  startConversation(): void {
    this.conversationStarted = true;
    if (this.greeter) playAnimation(this.greeter.animations, "Idle1");
  }

  private readonly update = (): void => {
    if (!this.camera) return;
    if (this.watchers.length === 2) {
      const center = Vector3.Center(this.watchers[0].root.position, this.watchers[1].root.position);
      const distance = Math.hypot(this.camera.position.x - center.x, this.camera.position.z - center.z);
      this.jokeActive = !this.jokeCompleted && distance <= (this.jokeActive ? 5 : 4.5);
      if (this.jokeActive) {
        this.jokeTime += Math.min(this.scene.getEngine().getDeltaTime(), 100);
        if (this.jokeTime >= this.jokes.length * 4000) {
          this.jokeCompleted = true;
          this.jokeActive = false;
        }
      }
      const line = Math.floor(this.jokeTime / 4000);
      this.jokes.forEach((bubble, index) => bubble.setEnabled(this.jokeActive && index === line));
    }
    for (const watcher of this.watchers) {
      watcher.root.rotation.y = yawToward(watcher.root.position, this.camera.position);
    }
  };

  private createJoke(): void {
    if (this.watchers.length !== 2) return;
    const lines = [
      ["Ваш главный недостаток?"],
      ["Честность."],
      ["Не думаю, что это недостаток."],
      ["А я и не спрашивал,", "что вы думаете."],
    ];
    lines.forEach((linesOfText, index) => {
      const texture = new DynamicTexture(`watcher-joke-${index}`, { width: 1024, height: 256 }, this.scene, false);
      const context = texture.getContext();
      context.fillStyle = "#fffff5";
      context.fillRect(0, 0, 1024, 256);
      context.strokeStyle = "#242822";
      context.lineWidth = 8;
      context.strokeRect(4, 4, 1016, 248);
      context.font = "bold 44px sans-serif";
      context.textAlign = "center";
      context.fillStyle = "#171b18";
      linesOfText.forEach((line, row) => context.fillText(line, 512, linesOfText.length === 1 ? 145 : 110 + row * 60));
      texture.update();
      const material = new StandardMaterial(`watcher-joke-material-${index}`, this.scene);
      material.diffuseTexture = texture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.backFaceCulling = false;
      const bubble = MeshBuilder.CreatePlane(`watcher-joke-bubble-${index}`, { width: 2.6, height: 0.65 }, this.scene);
      bubble.material = material;
      bubble.billboardMode = Mesh.BILLBOARDMODE_ALL;
      bubble.isPickable = false;
      bubble.position.copyFrom(this.watchers[index % 2].root.position);
      bubble.position.y += 2.65;
      bubble.setEnabled(false);
      this.jokes.push(bubble);
    });
  }

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
