import { Color3, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { GRID_TEXTURE_URL, WORLD } from "../game/config";

/**
 * Единственная текстура прототипа — тёмная панель с сеткой.
 * Клонируем её для разных поверхностей, чтобы независимо управлять тайлингом.
 */
function gridTexture(scene: Scene, name: string, uScale: number, vScale: number): Texture {
  const texture = new Texture(GRID_TEXTURE_URL, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = name;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = uScale;
  texture.vScale = vScale;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

function lit(material: StandardMaterial): StandardMaterial {
  // В сцене hemi + sun + 4 точечных источника.
  material.maxSimultaneousLights = 8;
  return material;
}

export function createMaterials(scene: Scene) {
  const tileSize = 2; // одна клетка текстуры = 2 м
  const wallLength = WORLD.size + WORLD.wallThickness * 2;

  const floor = lit(new StandardMaterial("floor", scene));
  floor.diffuseTexture = gridTexture(scene, "floorGrid", WORLD.size / tileSize, WORLD.size / tileSize);
  floor.diffuseColor = new Color3(1.35, 1.38, 1.42);
  floor.specularColor = new Color3(0.18, 0.2, 0.22);
  floor.specularPower = 96;

  // У бокса на гранях ±Z ось U идёт вдоль длины стены, а V — по высоте.
  const accentWall = lit(new StandardMaterial("accentWall", scene));
  accentWall.diffuseTexture = gridTexture(
    scene,
    "accentGrid",
    wallLength / tileSize,
    WORLD.height / tileSize,
  );
  accentWall.diffuseColor = new Color3(0.9, 0.93, 0.97);
  accentWall.specularColor = new Color3(0.08, 0.09, 0.1);
  accentWall.specularPower = 48;

  // На гранях ±X у бокса U идёт по высоте, а V — вдоль длины стены,
  // поэтому тайлинг переставлен местами: иначе сетка вытягивается в полосы.
  const accentWallSide = lit(new StandardMaterial("accentWallSide", scene));
  accentWallSide.diffuseTexture = gridTexture(
    scene,
    "accentGridSide",
    WORLD.height / tileSize,
    wallLength / tileSize,
  );
  accentWallSide.diffuseColor = accentWall.diffuseColor.clone();
  accentWallSide.specularColor = accentWall.specularColor.clone();
  accentWallSide.specularPower = accentWall.specularPower;

  const wallPaint = lit(new StandardMaterial("wallPaint", scene));
  wallPaint.diffuseColor = new Color3(0.82, 0.83, 0.85);
  wallPaint.specularColor = new Color3(0.05, 0.05, 0.055);
  wallPaint.specularPower = 16;

  const ceiling = lit(new StandardMaterial("ceiling", scene));
  ceiling.diffuseColor = new Color3(0.87, 0.88, 0.9);
  ceiling.emissiveColor = new Color3(0.04, 0.04, 0.045);
  ceiling.specularColor = new Color3(0.03, 0.03, 0.03);
  ceiling.specularPower = 12;

  const trim = lit(new StandardMaterial("trim", scene));
  trim.diffuseColor = new Color3(0.075, 0.08, 0.09);
  trim.specularColor = new Color3(0.42, 0.46, 0.5);
  trim.specularPower = 72;

  const wood = lit(new StandardMaterial("wood", scene));
  wood.diffuseColor = new Color3(0.36, 0.24, 0.15);
  wood.specularColor = new Color3(0.09, 0.08, 0.07);
  wood.specularPower = 24;

  const acoustic = lit(new StandardMaterial("acoustic", scene));
  acoustic.diffuseColor = new Color3(0.78, 0.8, 0.81);
  acoustic.specularColor = new Color3(0.02, 0.02, 0.02);
  acoustic.specularPower = 8;

  const glass = lit(new StandardMaterial("glass", scene));
  glass.diffuseColor = new Color3(0.55, 0.7, 0.82);
  glass.alpha = 0.16;
  glass.specularColor = new Color3(1, 1, 1);
  glass.specularPower = 512;
  glass.backFaceCulling = false;

  const lightPanel = new StandardMaterial("lightPanel", scene);
  lightPanel.disableLighting = true;
  lightPanel.diffuseColor = Color3.Black();
  lightPanel.emissiveColor = new Color3(2.6, 2.45, 2.15);
  lightPanel.specularColor = Color3.Black();

  lightPanel.maxSimultaneousLights = 1;

  return {
    floor,
    accentWall,
    accentWallSide,
    wallPaint,
    ceiling,
    trim,
    wood,
    acoustic,
    glass,
    lightPanel,
  };
}

export type OfficeMaterials = ReturnType<typeof createMaterials>;
