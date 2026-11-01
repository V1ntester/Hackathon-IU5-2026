import { Game } from "./game/Game";
import "./style.css";

const canvas = document.getElementById("game-canvas");
const uiRoot = document.getElementById("ui-root");

if (!(canvas instanceof HTMLCanvasElement) || !(uiRoot instanceof HTMLElement)) {
  throw new Error("Не найдены canvas#game-canvas или #ui-root в index.html");
}

const game = new Game(canvas, uiRoot);

if (import.meta.env.DEV) {
  (window as Window & { __office?: Game }).__office = game;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
