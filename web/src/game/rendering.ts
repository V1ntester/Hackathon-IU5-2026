import {
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  type Camera,
  type Scene,
} from "@babylonjs/core";

export function createRenderPipeline(name: string, scene: Scene, camera: Camera): DefaultRenderingPipeline {
  const pipeline = new DefaultRenderingPipeline(name, true, scene, [camera]);
  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;

  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomWeight = 0.22;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;

  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.1;
  pipeline.imageProcessing.contrast = 1.03;

  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 1.4;
  pipeline.imageProcessing.vignetteStretch = 0.5;

  return pipeline;
}
