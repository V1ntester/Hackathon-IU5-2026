import { ensureAuth } from "./auth";
import "./admin.css";

void ensureAuth().then(async (user) => {
  if (user.role !== "admin") {
    const root = document.getElementById("admin-root")!;
    root.innerHTML = '<main class="admin-shell"><h1>Доступ только администратору</h1><a href="/">Вернуться в игру</a></main>';
    return;
  }
  await import("./admin-panel");
}).catch((error: unknown) => {
  document.getElementById("admin-root")!.textContent = error instanceof Error ? error.message : "Не удалось войти";
});
