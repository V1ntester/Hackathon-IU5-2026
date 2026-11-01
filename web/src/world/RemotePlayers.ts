import {
  ImportMeshAsync,
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AnimationGroup,
  type Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import type { PlayerState } from "../network/GameClient";
import { ASSETS_URL, PLAYER } from "../game/config";

const MODEL_SCALE = 1.25;
const NICKNAME_HEIGHT = 2.25;
const MODEL_YAW_OFFSET = Math.PI / 2;
const MOVEMENT_THRESHOLD_SQUARED = 0.0001;

interface Avatar {
  root: TransformNode;
  target: Vector3;
  yaw: number;
  animations: AnimationGroup[] | null;
  currentAnimation: string | null;
  moving: boolean;
  label: Mesh;
  labelTexture: DynamicTexture;
  labelMaterial: StandardMaterial;
  nickname: string;
}

export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>();

  constructor(private readonly scene: Scene) {
    scene.onBeforeRenderObservable.add(this.update);
  }

  sync(players: PlayerState[], localId: string): void {
    const present = new Set<string>();
    for (const player of players) {
      if (player.id === localId) continue;
      present.add(player.id);
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        const root = new TransformNode(`player-${player.id}`, this.scene);
        root.position.set(
          player.position.x,
          player.position.y - PLAYER.eyeHeight,
          player.position.z,
        );
        root.scaling.setAll(MODEL_SCALE);
        const yaw = player.rotation_y + MODEL_YAW_OFFSET;
        root.rotation.y = yaw;
        const labelTexture = new DynamicTexture(`nickname-${player.id}`, { width: 1024, height: 128 }, this.scene, false);
        labelTexture.hasAlpha = true;
        const labelMaterial = new StandardMaterial(`nickname-material-${player.id}`, this.scene);
        labelMaterial.diffuseTexture = labelTexture;
        labelMaterial.emissiveColor = Color3.White();
        labelMaterial.disableLighting = true;
        labelMaterial.backFaceCulling = false;
        labelMaterial.useAlphaFromDiffuseTexture = true;
        const label = MeshBuilder.CreatePlane(`nickname-label-${player.id}`, { width: 3.1, height: 0.3875 }, this.scene);
        label.material = labelMaterial;
        label.billboardMode = Mesh.BILLBOARDMODE_ALL;
        label.isPickable = false;
        label.position.copyFrom(root.position);
        label.position.y += NICKNAME_HEIGHT;
        avatar = {
          root,
          target: root.position.clone(),
          yaw,
          animations: null,
          currentAnimation: null,
          moving: false,
          label,
          labelTexture,
          labelMaterial,
          nickname: "",
        };
        this.avatars.set(player.id, avatar);
        void this.loadModel(player.id, avatar);
      }
      if (avatar.nickname !== player.display_name) {
        avatar.nickname = player.display_name;
        const context = avatar.labelTexture.getContext();
        context.clearRect(0, 0, 1024, 128);
        context.font = "bold 48px sans-serif";
        const width = context.measureText(player.display_name).width;
        const size = Math.min(48, Math.floor(960 / Math.max(width, 1) * 48));
        context.font = `bold ${size}px sans-serif`;
        context.textAlign = "center";
        context.lineJoin = "round";
        context.lineWidth = 10;
        context.strokeStyle = "#ffffff";
        context.fillStyle = "#000000";
        context.strokeText(player.display_name, 512, 82);
        context.fillText(player.display_name, 512, 82);
        avatar.labelTexture.update();
      }
      avatar.target.set(
        player.position.x,
        player.position.y - PLAYER.eyeHeight,
        player.position.z,
      );
      avatar.yaw = player.rotation_y + MODEL_YAW_OFFSET;
    }
    for (const [id, avatar] of this.avatars) {
      if (!present.has(id)) this.removeAvatar(id, avatar);
    }
  }

  private async loadModel(id: string, avatar: Avatar): Promise<void> {
    try {
      const result = await ImportMeshAsync("employee_stickman.glb", this.scene, {
        rootUrl: ASSETS_URL,
      });
      const model = result.meshes[0];
      if (!model) return;

      if (avatar.root.isDisposed()) {
        for (const animation of result.animationGroups) animation.dispose();
        for (const mesh of result.meshes) mesh.dispose();
        return;
      }

      model.parent = avatar.root;
      for (const mesh of result.meshes) mesh.isPickable = false;
      avatar.animations = result.animationGroups;
      avatar.label.position.copyFrom(avatar.root.position);
      avatar.label.position.y += NICKNAME_HEIGHT;
      this.playAnimation(avatar, avatar.moving ? "Walk" : "Idle1");
    } catch (error) {
      if (!avatar.root.isDisposed()) {
        console.error(`Не удалось загрузить модель удалённого игрока ${id}:`, error);
      }
    }
  }

  private playAnimation(avatar: Avatar, name: string): void {
    if (!avatar.animations || avatar.currentAnimation === name) return;

    for (const animation of avatar.animations) animation.stop();
    const animation = avatar.animations.find((candidate) => candidate.name === name);
    if (animation) {
      animation.start(true);
    } else {
      console.warn(`Анимация ${name} не найдена у удалённого игрока.`);
    }
    avatar.currentAnimation = name;
  }

  private readonly update = (): void => {
    const blend = 1 - Math.exp(-15 * Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1));
    for (const avatar of this.avatars.values()) {
      avatar.moving = Vector3.DistanceSquared(avatar.root.position, avatar.target)
        > MOVEMENT_THRESHOLD_SQUARED;
      if (avatar.moving) {
        Vector3.LerpToRef(avatar.root.position, avatar.target, blend, avatar.root.position);
      } else {
        avatar.root.position.copyFrom(avatar.target);
      }
      avatar.label.position.copyFrom(avatar.root.position);
      avatar.label.position.y += NICKNAME_HEIGHT;
      this.playAnimation(avatar, avatar.moving ? "Walk" : "Idle1");

      const delta = avatar.yaw - avatar.root.rotation.y;
      avatar.root.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta)) * blend;
    }
  };

  private removeAvatar(id: string, avatar: Avatar): void {
    for (const animation of avatar.animations ?? []) animation.dispose();
    avatar.label.dispose();
    avatar.labelMaterial.dispose();
    avatar.labelTexture.dispose();
    avatar.root.dispose();
    this.avatars.delete(id);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    for (const [id, avatar] of this.avatars) this.removeAvatar(id, avatar);
  }
}
