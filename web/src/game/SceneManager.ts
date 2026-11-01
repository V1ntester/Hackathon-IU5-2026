import { Vector3, type Engine, type Scene } from "@babylonjs/core";
import type { FirstPersonController } from "../player/FirstPersonController";
import type { InterviewRoom } from "../world/InterviewRoom";
import { createRenderPipeline } from "./rendering";

export class SceneManager {
  private activeScene: Scene;
  private readonly officeReturnPosition = Vector3.Zero();
  private readonly officeReturnRotation = Vector3.Zero();

  constructor(
    private readonly engine: Engine,
    readonly office: Scene,
    readonly interview: InterviewRoom,
    private readonly player: FirstPersonController,
  ) {
    this.activeScene = office;
    createRenderPipeline("officePipeline", office, player.camera);
    createRenderPipeline("interviewPipeline", interview.scene, interview.camera);
  }

  get isInterviewActive(): boolean {
    return this.activeScene === this.interview.scene;
  }

  start(): void {
    this.engine.runRenderLoop(this.render);
  }

  enterInterview(): void {
    if (this.isInterviewActive) return;

    this.officeReturnPosition.copyFrom(this.player.camera.position);
    this.officeReturnRotation.copyFrom(this.player.camera.rotation);
    this.activeScene = this.interview.scene;
    this.player.setEnabled(false);
  }

  returnToOffice(): void {
    if (!this.isInterviewActive) return;

    this.activeScene = this.office;
    this.player.camera.position.copyFrom(this.officeReturnPosition);
    this.player.camera.rotation.copyFrom(this.officeReturnRotation);
  }

  dispose(): void {
    this.engine.stopRenderLoop(this.render);
  }

  private readonly render = (): void => {
    this.activeScene.render();
  };
}
