import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  ImportMeshAsync,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { ASSETS_URL, PLAYER, SPAWN, WORLD } from "../game/config";
import { createLighting, type OfficeLighting } from "./lighting";
import { createMaterials, type OfficeMaterials } from "./materials";
import { OfficeNpcs } from "./OfficeNpcs";

const TOTAL_WIDTH = WORLD.size + WORLD.wallThickness * 2;

function enableCollisions(meshes: readonly AbstractMesh[]): void {
  for (const mesh of meshes) {
    mesh.checkCollisions = mesh.getTotalVertices() > 0;
  }
}

/**
 * Каркас офиса: пол, потолок, глухие стены, витражные стены,
 * колонны и потолочные светильники. Мебель и NPC загружаются асинхронно из GLB.
 */
export class Office {
  readonly spawn: Vector3;
  readonly materials: OfficeMaterials;
  readonly npcs: OfficeNpcs;
  readonly interviewDoorPosition = new Vector3(0, 0, -13);
  readonly lightSwitchPosition = new Vector3(1.35, 1.15, -12.97);
  isLightOn = true;

  private readonly scene: Scene;
  private readonly lighting: OfficeLighting;

  constructor(scene: Scene) {
    this.scene = scene;
    this.materials = createMaterials(scene);
    this.lighting = createLighting(scene);
    this.npcs = new OfficeNpcs(scene, this.lighting.shadows);

    this.buildFloor();
    this.buildCeiling();

    // Глухие стены: -Z и +X.
    this.buildSolidWall("wallBack", 0, -WORLD.size / 2 - WORLD.wallThickness / 2, true);
    this.buildSolidWall("wallRight", WORLD.size / 2 + WORLD.wallThickness / 2, 0, false);

    // Витражные стены: +Z и -X (угловые окна).
    this.buildWindowWall("wallFront", new Vector3(0, 0, WORLD.size / 2 + WORLD.wallThickness / 2), 0);
    this.buildWindowWall(
      "wallLeft",
      new Vector3(-WORLD.size / 2 - WORLD.wallThickness / 2, 0, 0),
      -Math.PI / 2,
    );

    this.buildCeilingLights();
    this.setLightEnabled(true);

    for (const mesh of scene.meshes) {
      if (mesh.metadata?.castShadow === true) {
        this.lighting.shadows.addShadowCaster(mesh);
      }
    }

    this.spawn = new Vector3(SPAWN.x, PLAYER.eyeHeight, SPAWN.z);

    void this.init();
  }

  public async init(): Promise<void> {
      await this.setupOfficeProps();

      for (const mesh of this.scene.meshes) {
          if (mesh.metadata?.castShadow === true) {
              this.lighting.shadows.addShadowCaster(mesh);
          }
      }
  }

  setLightEnabled(enabled: boolean): void {
    this.isLightOn = enabled;
    this.lighting.setEnabled(this.isLightOn);
    this.materials.lightPanel.emissiveColor = this.isLightOn
      ? new Color3(2.6, 2.45, 2.15)
      : Color3.Black();
  }

  private buildFloor(): void {
    const floor = MeshBuilder.CreateGround(
      "floor",
      { width: WORLD.size, height: WORLD.size, subdivisions: 1 },
      this.scene,
    );
    floor.material = this.materials.floor;
    floor.receiveShadows = true;
    floor.checkCollisions = true;
    floor.isPickable = false;
  }

  private buildCeiling(): void {
    const ceiling = MeshBuilder.CreateGround(
      "ceiling",
      { width: WORLD.size, height: WORLD.size, subdivisions: 1 },
      this.scene,
    );
    ceiling.position.y = WORLD.height;
    ceiling.rotation.x = Math.PI;
    ceiling.material = this.materials.ceiling;
    ceiling.isPickable = false;

    // Тёмный шов по периметру потолка.
    const inset = WORLD.size / 2 - 0.03;
    const strips: Array<[number, number, number, number]> = [
      [0, inset, WORLD.size, 0.06],
      [0, -inset, WORLD.size, 0.06],
      [inset, 0, 0.06, WORLD.size],
      [-inset, 0, 0.06, WORLD.size],
    ];
    for (const [x, z, width, depth] of strips) {
      const strip = MeshBuilder.CreateBox(
        "ceilingGap",
        { width, height: 0.08, depth },
        this.scene,
      );
      strip.position.set(x, WORLD.height - 0.04, z);
      strip.material = this.materials.trim;
      strip.isPickable = false;
    }
  }

  private buildSolidWall(name: string, x: number, z: number, alongX: boolean): void {
    const width = alongX ? TOTAL_WIDTH : WORLD.wallThickness;
    const depth = alongX ? WORLD.wallThickness : TOTAL_WIDTH;

    const wall = MeshBuilder.CreateBox(
      name,
      { width, height: WORLD.height, depth },
      this.scene,
    );
    wall.position.set(x, WORLD.height / 2, z);
    wall.material = alongX ? this.materials.accentWall : this.materials.accentWallSide;
    wall.receiveShadows = true;
    wall.checkCollisions = true;
    wall.metadata = { castShadow: true };

    // Плинтус уходит внутрь комнаты на 2 см.
    const inward = x !== 0 ? -Math.sign(x) : Math.sign(-z);

    if (alongX) {
      const skirting = MeshBuilder.CreateBox(
        `${name}Skirting`,
        { width: WORLD.size, height: 0.1, depth: 0.035 },
        this.scene,
      );
      skirting.position.set(0, 0.05, z + inward * (WORLD.wallThickness / 2 + 0.02));
      skirting.material = this.materials.trim;
      skirting.receiveShadows = true;
      skirting.isPickable = false;
    } else {
      const skirting = MeshBuilder.CreateBox(
        `${name}Skirting`,
        { width: 0.035, height: 0.1, depth: WORLD.size },
        this.scene,
      );
      skirting.position.set(x + inward * (WORLD.wallThickness / 2 + 0.02), 0.05, 0);
      skirting.material = this.materials.trim;
      skirting.receiveShadows = true;
      skirting.isPickable = false;
    }
  }

  /**
   * Витражная стена: низкая рама, стекло, импосты и невидимый коллайдер.
   * Локальные координаты: X — вдоль стены, Z — толщина.
   */
  private buildWindowWall(name: string, position: Vector3, rotationY: number): void {
    const root = new TransformNode(`${name}Root`, this.scene);
    root.position.copyFrom(position);
    root.rotation.y = rotationY;

    const glassHeight = WORLD.windowHead - WORLD.windowSill;
    const glassCenterY = WORLD.windowSill + glassHeight / 2;
    const headerHeight = WORLD.height - WORLD.windowHead;

    const glass = MeshBuilder.CreateBox(
      `${name}Glass`,
      { width: TOTAL_WIDTH, height: glassHeight, depth: 0.03 },
      this.scene,
    );
    glass.position.y = glassCenterY;
    glass.material = this.materials.glass;
    glass.parent = root;
    glass.isPickable = false;

    const sill = MeshBuilder.CreateBox(
      `${name}Sill`,
      { width: TOTAL_WIDTH, height: WORLD.windowSill, depth: WORLD.wallThickness },
      this.scene,
    );
    sill.position.y = WORLD.windowSill / 2;
    sill.material = this.materials.wallPaint;
    sill.receiveShadows = true;
    sill.parent = root;
    sill.metadata = { castShadow: true };

    const header = MeshBuilder.CreateBox(
      `${name}Header`,
      { width: TOTAL_WIDTH, height: headerHeight, depth: WORLD.wallThickness },
      this.scene,
    );
    header.position.y = WORLD.windowHead + headerHeight / 2;
    header.material = this.materials.wallPaint;
    header.receiveShadows = true;
    header.parent = root;
    header.metadata = { castShadow: true };

    // Переплёт: стойки + нижняя/верхняя обвязка + промежуточный импост.
    const frames: Mesh[] = [];
    const bays = 10;
    for (let i = 0; i <= bays; i++) {
      const mullion = MeshBuilder.CreateBox(
        `${name}Mullion${i}`,
        { width: 0.14, height: glassHeight, depth: 0.34 },
        this.scene,
      );
      mullion.position.set(-TOTAL_WIDTH / 2 + (TOTAL_WIDTH / bays) * i, glassCenterY, 0);
      mullion.material = this.materials.trim;
      frames.push(mullion);
    }

    const rails: Array<[number, number]> = [
      [WORLD.windowSill + 0.045, 0.09],
      [WORLD.windowSill + glassHeight * 0.62, 0.06],
      [WORLD.windowHead - 0.045, 0.09],
    ];
    for (const [y, height] of rails) {
      const rail = MeshBuilder.CreateBox(
        `${name}Rail`,
        { width: TOTAL_WIDTH, height, depth: 0.34 },
        this.scene,
      );
      rail.position.y = y;
      rail.material = this.materials.trim;
      frames.push(rail);
    }

    const mergedFrames = Mesh.MergeMeshes(frames, true, true, undefined, false, false);
    if (mergedFrames) {
      mergedFrames.name = `${name}Frames`;
      mergedFrames.material = this.materials.trim;
      mergedFrames.receiveShadows = true;
      mergedFrames.parent = root;
      mergedFrames.metadata = { castShadow: true };
    }

    // Плинтус и верхний шов — уже в локальной системе стены.
    const skirting = MeshBuilder.CreateBox(
      `${name}Skirting`,
      { width: WORLD.size, height: 0.1, depth: 0.035 },
      this.scene,
    );
    skirting.position.set(0, 0.05, -WORLD.wallThickness / 2 - 0.02);
    skirting.material = this.materials.trim;
    skirting.parent = root;
    skirting.isPickable = false;

    const ceilingGap = MeshBuilder.CreateBox(
      `${name}CeilingGap`,
      { width: WORLD.size, height: 0.08, depth: 0.035 },
      this.scene,
    );
    ceilingGap.position.set(0, WORLD.height - 0.04, -WORLD.wallThickness / 2 - 0.02);
    ceilingGap.material = this.materials.trim;
    ceilingGap.parent = root;
    ceilingGap.isPickable = false;

    // Невидимый барьер: выйти через стекло нельзя.
    const collider = MeshBuilder.CreateBox(
      `${name}Collider`,
      { width: TOTAL_WIDTH, height: WORLD.height, depth: 0.5 },
      this.scene,
    );
    collider.position.y = WORLD.height / 2;
    collider.parent = root;
    collider.isVisible = false;
    collider.isPickable = false;
    collider.checkCollisions = true;
  }

  /** Дополнительные секции интерьера: доступны, но пока не вызываются. */
  buildCornerPosts(): void {
    const half = WORLD.size / 2;
    for (const x of [-half, half]) {
      for (const z of [-half, half]) {
        const post = MeshBuilder.CreateBox(
          "cornerPost",
          { width: WORLD.cornerPost, height: WORLD.height, depth: WORLD.cornerPost },
          this.scene,
        );
        post.position.set(x, WORLD.height / 2, z);
        post.material = this.materials.trim;
        post.receiveShadows = true;
        post.checkCollisions = true;
        post.isPickable = false;
        post.metadata = { castShadow: true };
      }
    }
  }

  /** Акцентная стена с деревянными рейками — напротив входа. */
  buildFeatureWall(): void {
    const wallZ = -WORLD.size / 2;
    const width = 9.2;
    const slatHeight = 2.78;

    const backing = MeshBuilder.CreateBox(
      "featureBacking",
      { width, height: 2.94, depth: 0.04 },
      this.scene,
    );
    backing.position.set(0, 1.47, wallZ + 0.04);
    backing.material = this.materials.trim;
    backing.receiveShadows = true;

    const pitch = 0.135;
    const slatWidth = 0.075;
    const count = Math.floor(width / pitch);
    const slats: Mesh[] = [];
    for (let i = 0; i < count; i++) {
      const slat = MeshBuilder.CreateBox(
        `slat${i}`,
        { width: slatWidth, height: slatHeight, depth: 0.09 },
        this.scene,
      );
      slat.position.set(-width / 2 + pitch / 2 + i * pitch, 0.06 + slatHeight / 2, wallZ + 0.1);
      slat.material = this.materials.wood;
      slats.push(slat);
    }

    const mergedSlats = Mesh.MergeMeshes(slats, true, true, undefined, false, false);
    if (mergedSlats) {
      mergedSlats.name = "featureSlats";
      mergedSlats.material = this.materials.wood;
      mergedSlats.receiveShadows = true;
      mergedSlats.metadata = { castShadow: true };
    }

    const plinth = MeshBuilder.CreateBox(
      "featurePlinth",
      { width: width + 0.12, height: 0.08, depth: 0.16 },
      this.scene,
    );
    plinth.position.set(0, 0.04, wallZ + 0.08);
    plinth.material = this.materials.trim;
    plinth.isPickable = false;

    const topRail = MeshBuilder.CreateBox(
      "featureTopRail",
      { width: width + 0.12, height: 0.08, depth: 0.16 },
      this.scene,
    );
    topRail.position.set(0, 2.84, wallZ + 0.08);
    topRail.material = this.materials.trim;
    topRail.isPickable = false;

    for (const side of [-1, 1]) {
      const sideRail = MeshBuilder.CreateBox(
        "featureSideRail",
        { width: 0.08, height: 2.94, depth: 0.16 },
        this.scene,
      );
      sideRail.position.set(side * (width / 2 + 0.06), 1.47, wallZ + 0.08);
      sideRail.material = this.materials.trim;
      sideRail.isPickable = false;
    }
  }

  /** Акустические панели на глухой стене +X. */
  buildAcousticPanels(): void {
    const wallX = WORLD.size / 2;

    for (const z of [-6.6, 0, 6.6]) {
      const frame = MeshBuilder.CreateBox(
        `panelFrame${z}`,
        { width: 0.04, height: 2.5, depth: 2.1 },
        this.scene,
      );
      frame.position.set(wallX - 0.015, 1.6, z);
      frame.material = this.materials.trim;
      frame.receiveShadows = true;

      const panel = MeshBuilder.CreateBox(
        `acousticPanel${z}`,
        { width: 0.07, height: 2.3, depth: 1.9 },
        this.scene,
      );
      panel.position.set(wallX - 0.055, 1.6, z);
      panel.material = this.materials.acoustic;
      panel.receiveShadows = true;
    }
  }

  /** Четыре линии потолочных светильников. */
  private buildCeilingLights(): void {
    const housings: Mesh[] = [];
    const diffusers: Mesh[] = [];
    const lampY = WORLD.height - 0.04;

    for (const z of [-7.5, -2.5, 2.5, 7.5]) {
      const housing = MeshBuilder.CreateBox(
        "lightHousing",
        { width: 19.5, height: 0.08, depth: 0.42 },
        this.scene,
      );
      housing.position.set(0, lampY, z);
      housing.material = this.materials.trim;
      housing.isPickable = false;
      housings.push(housing);

      const diffuser = MeshBuilder.CreateBox(
        "lightDiffuser",
        { width: 19.2, height: 0.02, depth: 0.24 },
        this.scene,
      );
      diffuser.position.set(0, lampY - 0.045, z);
      diffuser.material = this.materials.lightPanel;
      diffuser.isPickable = false;
      diffusers.push(diffuser);
    }

    this.mergeDecor("lightHousings", housings, this.materials.trim);
    this.mergeDecor("lightDiffusers", diffusers, this.materials.lightPanel);
  }

  private mergeDecor(name: string, parts: Mesh[], material: StandardMaterial): AbstractMesh | null {
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) {
      return null;
    }
    merged.name = name;
    merged.material = material;
    return merged;
  }

  async setupOfficeProps(): Promise<void> {
    try {
      const doorResult = await ImportMeshAsync("low_poly_door.glb", this.scene, { rootUrl: ASSETS_URL });
      enableCollisions(doorResult.meshes);
      const door = doorResult.meshes[0];
      if (door) {
        door.position = this.interviewDoorPosition.clone();
        door.position.y = 1.5;
        door.metadata = { interactable: true, action: "Enter Interview" };
      }

      const switchResult = await ImportMeshAsync("light_switch.glb", this.scene, { rootUrl: ASSETS_URL });
      enableCollisions(switchResult.meshes);
      const lightSwitch = switchResult.meshes[0];
      if (lightSwitch) {
        lightSwitch.name = "officeLightSwitch";
        lightSwitch.position = this.lightSwitchPosition.clone();
        lightSwitch.scaling.setAll(1.5);
        for (const mesh of switchResult.meshes) {
          mesh.metadata = { interactable: true, action: "Toggle Light" };
        }
      }

      const deskPositions = [
        new Vector3(-3, 0, -3),
        new Vector3(3, 0, -3),
        new Vector3(-3, 0, 3),
        new Vector3(3, 0, 3),
      ];

      for (const pos of deskPositions) {
        const deskResult = await ImportMeshAsync("low-poly_desk_blockbench.glb", this.scene, {
          rootUrl: ASSETS_URL,
        });
        enableCollisions(deskResult.meshes);
        const desk = deskResult.meshes[0];
        if (desk) desk.position = pos;

        const pcResult = await ImportMeshAsync("hand-painted_low_poly_computer.glb", this.scene, {
          rootUrl: ASSETS_URL,
        });
        enableCollisions(pcResult.meshes);
        const pc = pcResult.meshes[0];
        if (pc) pc.position = new Vector3(pos.x, pos.y + 1.12, pos.z);

        const chairResult = await ImportMeshAsync("low_poly_office_chair.glb", this.scene, {
          rootUrl: ASSETS_URL,
        });
        enableCollisions(chairResult.meshes);
        const chair = chairResult.meshes[0];
        if (chair) {
          chair.position = new Vector3(pos.x, pos.y, pos.z + 1.2);
          chair.rotate(new Vector3(0, 1, 0), Math.PI);
        }
      }

      const signResult = await ImportMeshAsync("psx_wet_floor_sign.glb", this.scene, {
        rootUrl: ASSETS_URL,
      });
      enableCollisions(signResult.meshes);
      const sign = signResult.meshes[0];
      if (sign) sign.position = new Vector3(1.5, 0, -8.5);

      console.log("Все объекты успешно загружены и расставлены!");
    } catch (error) {
      console.error("Ошибка при загрузке моделей:", error);
    }
  }
}
