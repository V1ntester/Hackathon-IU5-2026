import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  PointLight,
  Scene,
  ShadowGenerator,
  Vector3,
} from "@babylonjs/core";

export interface OfficeLighting {
  sun: DirectionalLight;
  shadows: ShadowGenerator;
  setEnabled: (enabled: boolean) => void;
}

export function createLighting(scene: Scene): OfficeLighting {
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.95;
  ambient.diffuse = new Color3(0.8, 0.86, 0.97);
  ambient.groundColor = new Color3(0.5, 0.52, 0.56);
  ambient.specular = new Color3(0.08, 0.09, 0.1);

  const sun = new DirectionalLight("sun", new Vector3(0.45, -0.8, -0.45), scene);
  sun.position = new Vector3(-28, 40, 28);
  sun.intensity = 1.7;
  sun.diffuse = new Color3(1, 0.94, 0.84);
  sun.specular = new Color3(1, 0.95, 0.86);
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 120;

  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.001;
  shadows.normalBias = 0.02;
  shadows.darkness = 0.35;

  const fills: PointLight[] = [];
  for (const z of [-7.5, -2.5, 2.5, 7.5]) {
    const fill = new PointLight(`ceilingFill${z}`, new Vector3(0, 3.05, z), scene);
    fill.diffuse = new Color3(1, 0.92, 0.8);
    fill.specular = new Color3(0.5, 0.45, 0.38);
    fill.intensity = 9;
    fill.range = 13;
    fills.push(fill);
  }

  return {
    sun,
    shadows,
    setEnabled: (enabled: boolean) => {
      ambient.intensity = enabled ? 0.95 : 0.12;
      sun.intensity = enabled ? 1.7 : 0.2;
      for (const fill of fills) fill.setEnabled(enabled);
    },
  };
}
