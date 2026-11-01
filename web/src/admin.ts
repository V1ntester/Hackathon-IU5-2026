import "./admin.css";
import { isWorldObjectState, type WorldObjectState } from "./network/WorldObjectState";

const root = document.querySelector<HTMLElement>("#admin-root");
if (!root) throw new Error("Не найден #admin-root для панели управления");

root.innerHTML = [
  '<main class="admin-shell">',
  '  <header class="admin-header">',
  '    <a class="admin-brand" href="/" aria-label="Открыть игру"><span class="admin-mark">IU5</span><span>OFFICE SIMULATOR</span></a>',
  '    <a class="admin-back" href="/">Вернуться в игру <span aria-hidden="true">↗</span></a>',
  '  </header>',
  '  <section class="admin-intro" aria-labelledby="admin-title">',
  '    <p class="admin-eyebrow"><span class="admin-eyebrow-line"></span> Control room</p>',
  '    <h1 id="admin-title">Мир под<br /><span>контролем.</span></h1>',
  '    <p class="admin-lede">Состояние объектов общей игровой сессии.</p>',
  '  </section>',
  '  <section class="admin-content admin-content--connections" aria-labelledby="connections-title">',
  '    <div class="admin-section-heading"><div><p class="admin-overline">Сейчас в игре</p><h2 id="connections-title">Подключения <span class="admin-count" data-count>0</span></h2></div>',
  '      <span class="admin-refresh-label">Обновление каждые 2 секунды</span></div>',
  '    <div class="admin-connection-list" data-connections aria-live="polite"></div>',
  '  </section>',
  '  <section class="admin-content" aria-labelledby="objects-title">',
  '    <div class="admin-section-heading"><div><p class="admin-overline">Состояние сессии</p><h2 id="objects-title">Объекты мира</h2></div>',
  '      <div class="admin-live"><span class="admin-live-dot"></span><span data-connection>Соединение…</span></div></div>',
  '    <div class="admin-message" data-message role="status" aria-live="polite" hidden></div>',
  '    <div class="admin-object-list" data-objects aria-live="polite"></div>',
  '    <p class="admin-footnote">Изменения игроков появляются автоматически. Состояние хранится до перезапуска сервера.</p>',
  '  </section>',
  '  <footer class="admin-footer"><span>IU5 · ADMIN</span><span>Игровой сервер</span></footer>',
  '</main>',
].join("");

const list = root.querySelector<HTMLElement>("[data-objects]")!;
const connectionList = root.querySelector<HTMLElement>("[data-connections]")!;
const connectionCount = root.querySelector<HTMLElement>("[data-count]")!;
const message = root.querySelector<HTMLElement>("[data-message]")!;
const connection = root.querySelector<HTMLElement>("[data-connection]")!;
const apiBase = import.meta.env.VITE_BACKEND_URL || window.location.origin;
let requestInProgress = false;
let writeInProgress = 0;
let disposed = false;

function showMessage(text: string, isError = false): void {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle("is-error", isError);
}

function objectLabel(object: WorldObjectState): string {
  return object.id === "office-light" ? "Свет в лобби" : object.id;
}

function render(objects: WorldObjectState[]): void {
  list.replaceChildren();
  if (!objects.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.textContent = "В сессии пока нет объектов.";
    list.append(empty);
    return;
  }

  for (const object of objects) {
    const card = document.createElement("article");
    card.className = "object-card";
    const copy = document.createElement("div");
    copy.className = "object-copy";
    const icon = document.createElement("span");
    icon.className = "object-icon" + (object.state === "active" ? " is-active" : "");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = object.id === "office-light" ? "✳" : "◈";
    const details = document.createElement("div");
    details.className = "object-details";
    const name = document.createElement("h3");
    name.textContent = objectLabel(object);
    const meta = document.createElement("p");
    meta.textContent = object.id;
    details.append(name, meta);
    copy.append(icon, details);
    const controls = document.createElement("div");
    controls.className = "object-controls";
    controls.setAttribute("aria-label", "Состояние: " + objectLabel(object));
    for (const [state, label] of [["active", "Включить"], ["inactive", "Выключить"]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "object-action" + (object.state === state ? " is-selected" : "");
      button.textContent = label;
      button.disabled = writeInProgress > 0 || object.state === state;
      button.setAttribute("aria-pressed", String(object.state === state));
      button.addEventListener("click", () => void setState(object.id, state));
      controls.append(button);
    }
    card.append(copy, controls);
    list.append(card);
  }
}

async function responseDetail(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") return body.detail;
  return "Сервер ответил с кодом " + response.status + ".";
}

interface AdminConnection {
  player_id: string;
  display_name: string;
  connected_at: string;
  ping_ms: number | null;
  fps: number | null;
}

function isAdminConnection(value: unknown): value is AdminConnection {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AdminConnection>;
  return typeof row.player_id === "string" && typeof row.display_name === "string" &&
    typeof row.connected_at === "string" && Number.isFinite(Date.parse(row.connected_at)) &&
    (row.ping_ms === null || (typeof row.ping_ms === "number" && Number.isFinite(row.ping_ms) && row.ping_ms >= 0)) &&
    (row.fps === null || (typeof row.fps === "number" && Number.isFinite(row.fps) && row.fps >= 0));
}

function renderConnections(connections: AdminConnection[]): void {
  connectionList.replaceChildren();
  connectionCount.textContent = String(connections.length);
  if (!connections.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.textContent = "Сейчас игроков нет. Новые подключения появятся здесь автоматически.";
    connectionList.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "connection-table";
  table.innerHTML = '<thead><tr><th scope="col">Игрок</th><th scope="col">Подключён</th><th scope="col">Ping</th><th scope="col">FPS</th></tr></thead>';
  const body = document.createElement("tbody");
  for (const connection of connections) {
    const row = document.createElement("tr");
    const player = document.createElement("td");
    player.className = "connection-player";
    const name = document.createElement("strong");
    name.textContent = connection.display_name;
    const id = document.createElement("span");
    id.textContent = connection.player_id;
    player.append(name, id);

    const connected = document.createElement("td");
    connected.textContent = new Date(connection.connected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const ping = document.createElement("td");
    ping.className = "connection-metric";
    ping.textContent = connection.ping_ms === null ? "Измеряется…" : Math.round(connection.ping_ms) + " мс";
    if (connection.ping_ms !== null) ping.classList.add(connection.ping_ms > 180 ? "is-slow" : "is-good");
    const fps = document.createElement("td");
    fps.className = "connection-fps";
    fps.textContent = connection.fps === null ? "—" : Math.round(connection.fps) + " FPS";
    row.append(player, connected, ping, fps);
    body.append(row);
  }
  table.append(body);
  connectionList.append(table);
}

async function fetchConnections(): Promise<AdminConnection[]> {
  const response = await fetch(new URL("/api/admin/connections", apiBase), { cache: "no-store" });
  if (!response.ok) throw new Error(await responseDetail(response));
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isAdminConnection)) {
    throw new Error("Сервер вернул список подключений в неизвестном формате.");
  }
  return payload;
}

async function fetchObjects(): Promise<WorldObjectState[]> {
  const response = await fetch(new URL("/api/admin/objects", apiBase), { cache: "no-store" });
  if (!response.ok) throw new Error(await responseDetail(response));
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isWorldObjectState)) {
    throw new Error("Сервер вернул список объектов в неизвестном формате.");
  }
  return payload;
}

async function refresh(): Promise<void> {
  if (disposed || requestInProgress || writeInProgress > 0) return;
  requestInProgress = true;
  try {
    const [objects, connections] = await Promise.all([fetchObjects(), fetchConnections()]);
    if (disposed) return;
    render(objects);
    renderConnections(connections);
    connection.textContent = "Сервер на связи";
    connection.parentElement?.classList.add("is-connected");
    showMessage("");
  } catch (error) {
    if (disposed) return;
    connection.textContent = "Нет соединения";
    connection.parentElement?.classList.remove("is-connected");
    showMessage(error instanceof Error ? error.message : "Не удалось загрузить объекты.", true);
  } finally {
    requestInProgress = false;
  }
}

async function setState(objectId: string, state: WorldObjectState["state"]): Promise<void> {
  writeInProgress += 1;
  render(await fetchObjects().catch(() => []));
  try {
    const response = await fetch(new URL("/api/admin/objects/" + encodeURIComponent(objectId), apiBase), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) throw new Error(await responseDetail(response));
    const updated: unknown = await response.json();
    if (!isWorldObjectState(updated)) throw new Error("Сервер вернул неизвестное состояние объекта.");
    const objects = await fetchObjects();
    render(objects);
    connection.textContent = "Сервер на связи";
    connection.parentElement?.classList.add("is-connected");
    showMessage(objectLabel(updated) + ": " + (updated.state === "active" ? "включён" : "выключен") + ".");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Не удалось изменить состояние.", true);
  } finally {
    writeInProgress = Math.max(0, writeInProgress - 1);
    if (!disposed) await refresh();
  }
}

void refresh();
const poll = window.setInterval(() => void refresh(), 2000);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    window.clearInterval(poll);
  });
}
