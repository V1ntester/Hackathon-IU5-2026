import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  ImportMeshAsync,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  UniversalCamera,
  Vector3,
  type AbstractMesh,
  type Engine,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { ASSETS_URL, GRID_TEXTURE_URL } from "../game/config";

const ROOM = {
  width: 10,
  depth: 9,
  height: 3.4,
  wallThickness: 0.18,
} as const;

export class InterviewRoom {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  player: AbstractMesh | null = null;

  private readonly shadows: ShadowGenerator;

  constructor(engine: Engine) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.035, 0.045, 0.055, 1);

    this.camera = new UniversalCamera("interviewCamera", new Vector3(0, 1.35, 4.15), this.scene);
    this.camera.setTarget(new Vector3(0, 1.65, 0));
    this.camera.fov = 0.82;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 100;
    this.scene.activeCamera = this.camera;

    this.shadows = this.setupLighting();
    this.buildRoom();
    void this.init();
  }

  dispose(): void {
    this.scene.dispose();
  }

  private setupLighting(): ShadowGenerator {
    const ambient = new HemisphericLight("interviewAmbient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.85;
    ambient.diffuse = new Color3(0.82, 0.88, 1);
    ambient.groundColor = new Color3(0.4, 0.42, 0.45);

    const keyLight = new DirectionalLight(
      "interviewKeyLight",
      new Vector3(0.35, -1, -0.65),
      this.scene,
    );
    keyLight.position = new Vector3(-3, 6, 5);
    keyLight.intensity = 1.8;
    keyLight.diffuse = new Color3(1, 0.94, 0.85);
    keyLight.shadowMinZ = 1;
    keyLight.shadowMaxZ = 30;

    const shadows = new ShadowGenerator(1024, keyLight);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.001;
    shadows.normalBias = 0.02;
    shadows.darkness = 0.4;

    const fill = new PointLight("interviewFill", new Vector3(0, 2.9, 1.6), this.scene);
    fill.intensity = 10;
    fill.range = 10;
    fill.diffuse = new Color3(1, 0.93, 0.82);

    return shadows;
  }

  private buildRoom(): void {
    const floorMaterial = this.material("interviewFloor", new Color3(0.62, 0.66, 0.7));
    const floorTexture = new Texture(GRID_TEXTURE_URL, this.scene);
    floorTexture.uScale = ROOM.width / 2;
    floorTexture.vScale = ROOM.depth / 2;
    floorTexture.anisotropicFilteringLevel = 8;
    floorMaterial.diffuseTexture = floorTexture;

    const wallMaterial = this.material("interviewWall", new Color3(0.74, 0.77, 0.8));
    const accentMaterial = this.material("interviewAccent", new Color3(0.12, 0.2, 0.24));
    const woodMaterial = this.material("interviewWood", new Color3(0.32, 0.2, 0.12));
    const trimMaterial = this.material("interviewTrim", new Color3(0.055, 0.065, 0.075));
    const carpetMaterial = this.material("interviewCarpet", new Color3(0.15, 0.27, 0.31));

    const floor = MeshBuilder.CreateGround(
      "interviewFloor",
      { width: ROOM.width, height: ROOM.depth },
      this.scene,
    );
    floor.material = floorMaterial;
    floor.receiveShadows = true;
    floor.isPickable = false;

    const carpet = MeshBuilder.CreateGround(
      "interviewCarpet",
      { width: 3.4, height: 2.8 },
      this.scene,
    );
    carpet.position.y = 0.008;
    carpet.material = carpetMaterial;
    carpet.receiveShadows = true;
    carpet.isPickable = false;

    const ceiling = MeshBuilder.CreateGround(
      "interviewCeiling",
      { width: ROOM.width, height: ROOM.depth },
      this.scene,
    );
    ceiling.position.y = ROOM.height;
    ceiling.rotation.x = Math.PI;
    ceiling.material = this.material("interviewCeilingMaterial", new Color3(0.82, 0.84, 0.86));
    ceiling.isPickable = false;

    const halfWidth = ROOM.width / 2;
    const halfDepth = ROOM.depth / 2;
    this.box("interviewBackWall", ROOM.width, ROOM.height, ROOM.wallThickness, 0, ROOM.height / 2, -halfDepth, wallMaterial);
    this.box("interviewFrontWall", ROOM.width, ROOM.height, ROOM.wallThickness, 0, ROOM.height / 2, halfDepth, wallMaterial);
    this.box("interviewLeftWall", ROOM.wallThickness, ROOM.height, ROOM.depth, -halfWidth, ROOM.height / 2, 0, wallMaterial);
    this.box("interviewRightWall", ROOM.wallThickness, ROOM.height, ROOM.depth, halfWidth, ROOM.height / 2, 0, wallMaterial);

    this.box("interviewBackSkirting", ROOM.width, 0.12, 0.05, 0, 0.06, -halfDepth + 0.11, trimMaterial);
    this.box("interviewLeftSkirting", 0.05, 0.12, ROOM.depth, -halfWidth + 0.11, 0.06, 0, trimMaterial);
    this.box("interviewRightSkirting", 0.05, 0.12, ROOM.depth, halfWidth - 0.11, 0.06, 0, trimMaterial);

    this.box("interviewFeatureWall", 4.8, 2.9, 0.08, 0, 1.55, -halfDepth + 0.14, accentMaterial);
    for (let index = 0; index < 7; index += 1) {
      const x = -2.1 + index * 0.7;
      this.box("interviewWoodSlat", 0.075, 2.9, 0.06, x, 1.55, -halfDepth + 0.21, woodMaterial);
    }

    const signTexture = new DynamicTexture(
      "interviewSignTexture",
      { width: 1024, height: 256 },
      this.scene,
      false,
    );
    signTexture.drawText(
      "INTERVIEW",
      null,
      150,
      "600 96px Segoe UI",
      "#e8efec",
      "#173039",
      true,
      true,
    );
    const signMaterial = new StandardMaterial("interviewSignMaterial", this.scene);
    signMaterial.disableLighting = true;
    signMaterial.diffuseTexture = signTexture;
    signMaterial.emissiveTexture = signTexture;
    signMaterial.backFaceCulling = false;
    const sign = MeshBuilder.CreatePlane(
      "interviewSign",
      { width: 3.2, height: 0.8 },
      this.scene,
    );
    sign.position.set(0, 2.25, -halfDepth + 0.26);
    sign.rotation.y = Math.PI;
    sign.material = signMaterial;
    sign.isPickable = false;

    const lightMaterial = new StandardMaterial("interviewLightMaterial", this.scene);
    lightMaterial.disableLighting = true;
    lightMaterial.emissiveColor = new Color3(2.2, 2.1, 1.9);
    for (const z of [-1.8, 1.8]) {
      this.box("interviewLightHousing", 3.4, 0.07, 0.42, 0, ROOM.height - 0.05, z, trimMaterial);
      this.box("interviewLightPanel", 3.2, 0.025, 0.28, 0, ROOM.height - 0.095, z, lightMaterial);
    }
  }

  private material(name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.specularColor = new Color3(0.08, 0.08, 0.08);
    material.specularPower = 32;
    return material;
  }

  private box(
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: StandardMaterial,
  ): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    this.shadows.addShadowCaster(mesh);
    return mesh;
  }

  private async init(): Promise<void> {
    const props = [
      this.placeModel("low-poly_desk_blockbench.glb", new Vector3(0, 0, -2.25)),
      this.placeModel("hand-painted_low_poly_computer.glb", new Vector3(0, 1.12, -2.25)),
      this.placeModel("low_poly_office_chair.glb", new Vector3(0, 0, -3.25)),
      this.placeModel("low_poly_door.glb", new Vector3(4.82, 1.5, 2.45), -Math.PI / 2),
    ];

    this.player = await this.placeModel(
      "employee_stickman.glb",
      Vector3.Zero(),
      Math.PI / 2,
      1.25,
      "Idle",
    );
    if (this.player) {
      this.player.name = "interviewPlayer";
      this.player.metadata = { localPlayer: true };
    }

    await Promise.all(props);
  }

  private async placeModel(
    file: string,
    position: Vector3,
    yaw = 0,
    scale = 1,
    animationName?: string,
  ): Promise<AbstractMesh | null> {
    try {
      const result = await ImportMeshAsync(file, this.scene, { rootUrl: ASSETS_URL });
      const root = result.meshes[0];
      if (!root) return null;

      root.position = position;
      if (yaw !== 0) root.rotate(Vector3.Up(), yaw);
      root.scaling.setAll(scale);
      for (const mesh of result.meshes) {
        if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
          this.shadows.addShadowCaster(mesh);
        }
      }

      if (animationName) {
        for (const group of result.animationGroups) group.stop();
        const normalizedName = animationName.toLowerCase();
        const animation = result.animationGroups.find(
          (group) => group.name.toLowerCase() === normalizedName,
        ) ?? result.animationGroups.find(
          (group) => group.name.toLowerCase().includes(normalizedName),
        );
        if (animation) {
          animation.start(true);
        } else {
          console.warn(`Анимация ${animationName} не найдена в модели ${file}.`);
        }
      }
      return root;
    } catch (error) {
      console.error(`Не удалось загрузить модель ${file} для кабинета:`, error);
      return null;
    }
  }
}
