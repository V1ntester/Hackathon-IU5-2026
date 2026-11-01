import {
  Mesh,
  MeshBuilder,
  Vector3,
  type AbstractMesh,
  type Scene,
} from "@babylonjs/core";
import { PLAYER } from "../game/config";

const MAX_PUSH_SPEED = 3;
const SLIDING_DECELERATION = 8;
const CONTACT_OFFSET = 0.02;

export class PushableSign {
  private readonly collider: Mesh;
  private readonly modelOffset: Vector3;
  private readonly velocity = Vector3.Zero();
  private readonly movement = Vector3.Zero();
  private readonly halfWidth: number;
  private readonly halfDepth: number;
  private readonly floorCenterY: number;

  constructor(private readonly model: AbstractMesh, scene: Scene) {
    model.computeWorldMatrix(true);
    const bounds = model.getHierarchyBoundingVectors(true);
    const size = bounds.max.subtract(bounds.min);
    const width = Math.max(size.x, 0.1);
    const height = Math.max(size.y, 0.1);
    const depth = Math.max(size.z, 0.1);

    this.halfWidth = width / 2;
    this.halfDepth = depth / 2;
    this.collider = MeshBuilder.CreateBox(
      "wetFloorSignCollider",
      { width, height, depth },
      scene,
    );
    this.collider.position.copyFrom(bounds.min).addInPlace(bounds.max).scaleInPlace(0.5);
    this.floorCenterY = this.collider.position.y;
    this.collider.checkCollisions = true;
    this.collider.isVisible = false;
    this.collider.isPickable = false;

    this.modelOffset = model.position.subtract(this.collider.position);
    model.checkCollisions = false;
    for (const mesh of model.getChildMeshes()) {
      mesh.checkCollisions = false;
    }
  }

  update(dt: number, playerPosition: Vector3, playerDisplacement: Vector3): void {
    if (dt <= 0) return;

    let pushed = false;
    const offsetX = playerPosition.x - this.collider.position.x;
    const offsetZ = playerPosition.z - this.collider.position.z;
    const closestX = Math.max(-this.halfWidth, Math.min(this.halfWidth, offsetX));
    const closestZ = Math.max(-this.halfDepth, Math.min(this.halfDepth, offsetZ));
    let normalX = offsetX - closestX;
    let normalZ = offsetZ - closestZ;
    const distanceSquared = normalX * normalX + normalZ * normalZ;
    const contactRadius = PLAYER.collisionRadius + CONTACT_OFFSET;

    if (distanceSquared <= contactRadius * contactRadius) {
      if (distanceSquared < 1e-8) {
        const distanceToX = this.halfWidth - Math.abs(offsetX);
        const distanceToZ = this.halfDepth - Math.abs(offsetZ);
        if (distanceToX < distanceToZ) {
          normalX = Math.sign(offsetX) || 1;
          normalZ = 0;
        } else {
          normalX = 0;
          normalZ = Math.sign(offsetZ) || 1;
        }
      } else {
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        normalX *= inverseDistance;
        normalZ *= inverseDistance;
      }

      const speedTowardPlayer = this.velocity.x * normalX + this.velocity.z * normalZ;
      if (speedTowardPlayer > 0) {
        this.velocity.x -= normalX * speedTowardPlayer;
        this.velocity.z -= normalZ * speedTowardPlayer;
      }

      const approach = -(playerDisplacement.x * normalX + playerDisplacement.z * normalZ);
      if (approach > 0) {
        pushed = true;
        const pushSpeed = Math.min(MAX_PUSH_SPEED, approach / dt);
        const currentSpeed = -(this.velocity.x * normalX + this.velocity.z * normalZ);
        if (currentSpeed < pushSpeed) {
          const acceleration = pushSpeed - currentSpeed;
          this.velocity.x -= normalX * acceleration;
          this.velocity.z -= normalZ * acceleration;
        }
      }
    }

    if (!pushed) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed <= SLIDING_DECELERATION * dt) {
        this.velocity.setAll(0);
      } else if (speed > 0) {
        const scale = (speed - SLIDING_DECELERATION * dt) / speed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    }

    this.movement.copyFromFloats(this.velocity.x * dt, 0, this.velocity.z * dt);
    if (this.movement.lengthSquared() < 1e-10) return;

    const previousX = this.collider.position.x;
    const previousZ = this.collider.position.z;
    this.collider.moveWithCollisions(this.movement);
    this.collider.position.y = this.floorCenterY;
    this.velocity.copyFromFloats(
      (this.collider.position.x - previousX) / dt,
      0,
      (this.collider.position.z - previousZ) / dt,
    );

    this.model.position.copyFrom(this.collider.position).addInPlace(this.modelOffset);
  }
}
