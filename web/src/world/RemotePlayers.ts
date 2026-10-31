import { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { PlayerState } from "../network/GameClient";
import { PLAYER } from "../game/config";

interface Avatar {
  root: TransformNode;
  target: Vector3;
  yaw: number;
}

export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>();
  private readonly material: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.material = new StandardMaterial("remotePlayerMaterial", scene);
    this.material.diffuseColor = new Color3(0.55, 0.8, 0.3);
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
        const body = MeshBuilder.CreateCapsule(`body-${player.id}`, {
          height: PLAYER.eyeHeight, radius: PLAYER.collisionRadius,
        }, this.scene);
        body.parent = root;
        body.position.y = -PLAYER.eyeHeight / 2;
        body.material = this.material;
        body.isPickable = false;
        const nose = MeshBuilder.CreateBox(`direction-${player.id}`, { size: 0.18 }, this.scene);
        nose.parent = root;
        nose.position.set(0, -0.25, PLAYER.collisionRadius);
        nose.material = this.material;
        nose.isPickable = false;
        root.position.set(player.position.x, player.position.y, player.position.z);
        root.rotation.y = player.rotation_y;
        avatar = { root, target: root.position.clone(), yaw: player.rotation_y };
        this.avatars.set(player.id, avatar);
      }
      avatar.target.set(player.position.x, player.position.y, player.position.z);
      avatar.yaw = player.rotation_y;
    }
    for (const [id, avatar] of this.avatars) {
      if (!present.has(id)) {
        avatar.root.dispose();
        this.avatars.delete(id);
      }
    }
  }

  private readonly update = (): void => {
    const blend = 1 - Math.exp(-15 * Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1));
    for (const avatar of this.avatars.values()) {
      Vector3.LerpToRef(avatar.root.position, avatar.target, blend, avatar.root.position);
      const delta = avatar.yaw - avatar.root.rotation.y;
      avatar.root.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta)) * blend;
    }
  };

  dispose(): void {
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    for (const avatar of this.avatars.values()) avatar.root.dispose();
    this.avatars.clear();
    this.material.dispose();
  }
}
