import { ensureAuth } from "./auth";
import { Game } from "./game/Game";
import "./style.css";

async function start(): Promise<void> {
  await ensureAuth();
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

}
void start().catch((error: unknown) => {
  const message = document.createElement("p");
  message.className = "auth-screen";
  message.textContent = error instanceof Error ? error.message : "Не удалось войти";
  document.body.append(message);
});
