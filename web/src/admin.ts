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
  '    <p class="admin-lede">Объекты общей игровой сессии и тема интервью.</p>',
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
  '  <section class="admin-content" aria-labelledby="interview-topic-title">',
  '    <div class="admin-section-heading"><div><p class="admin-overline">Интервью и RAG</p><h2 id="interview-topic-title">Тема интервью</h2></div></div>',
  '    <label class="topic-label" for="interview-topic">Общая тема для новых интервью</label>',
  '    <select class="topic-select" id="interview-topic" data-topic-select aria-describedby="topic-status" disabled><option>Загрузка тем…</option></select>',
  '    <p class="admin-footnote" id="topic-status" data-topic-status role="status">Загружаем настройку…</p>',
  '  </section>',
  '  <footer class="admin-footer"><span>IU5 · ADMIN</span><span>Игровой сервер</span></footer>',
  '</main>',
].join("");

const list = root.querySelector<HTMLElement>("[data-objects]")!;
const connectionList = root.querySelector<HTMLElement>("[data-connections]")!;
const connectionCount = root.querySelector<HTMLElement>("[data-count]")!;
const message = root.querySelector<HTMLElement>("[data-message]")!;
const connection = root.querySelector<HTMLElement>("[data-connection]")!;
const topicSelect = root.querySelector<HTMLSelectElement>("[data-topic-select]")!;
const topicStatus = root.querySelector<HTMLElement>("[data-topic-status]")!;
const apiBase = import.meta.env.VITE_BACKEND_URL || window.location.origin;
let requestInProgress = false;
let writeInProgress = 0;
let disposed = false;
let topicRequestInProgress = false;
let topicWriteInProgress = false;
let topicGeneration = 0;
let topicSettings: InterviewTopicSettings | null = null;

interface InterviewTopicSettings {
  scenario_id: string;
  topic: string | null;
  version: number;
  topics: { topic: string; question_count: number }[];
}

function isInterviewTopicSettings(value: unknown): value is InterviewTopicSettings {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<InterviewTopicSettings>;
  return row.scenario_id === "interview" && (row.topic === null || typeof row.topic === "string") &&
    typeof row.version === "number" && Number.isInteger(row.version) && row.version >= 0 &&
    Array.isArray(row.topics) && row.topics.every((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const option = item as { topic?: unknown; question_count?: unknown };
      return typeof option.topic === "string" && option.topic.length > 0 &&
        typeof option.question_count === "number" && Number.isInteger(option.question_count) && option.question_count >= 0;
    });
}

function renderTopic(settings: InterviewTopicSettings): void {
  const changed = JSON.stringify(topicSettings) !== JSON.stringify(settings);
  topicSettings = settings;
  if (changed) {
    const options: HTMLOptionElement[] = [];
    const all = document.createElement("option");
    all.value = ""; all.textContent = "Все темы"; options.push(all);
    for (const item of settings.topics) {
      const option = document.createElement("option");
      option.value = item.topic; option.textContent = `${item.topic} — вопросов: ${item.question_count}`;
      options.push(option);
    }
    if (settings.topic !== null && !settings.topics.some((item) => item.topic === settings.topic)) {
      const missing = document.createElement("option");
      missing.value = settings.topic; missing.textContent = `${settings.topic} — нет активных вопросов`;
      options.push(missing);
    }
    topicSelect.replaceChildren(...options);
  }
  topicSelect.value = settings.topic ?? "";
  topicSelect.disabled = topicWriteInProgress;
  const count = settings.topic === null
    ? settings.topics.reduce((sum, item) => sum + item.question_count, 0)
    : settings.topics.find((item) => item.topic === settings.topic)?.question_count ?? 0;
  topicStatus.classList.toggle("is-error", count < 4);
  topicStatus.textContent = count < 4
    ? `Активных вопросов: ${count}. Для интервью нужно минимум 4 пригодных вопроса. Добавьте вопросы или выберите другую тему.`
    : "Тема применяется к новым интервью и следующим репликам NPC. Начатые интервью сохраняют свою тему и вопросы.";
}

async function refreshTopic(): Promise<void> {
  if (disposed || topicRequestInProgress || topicWriteInProgress) return;
  topicRequestInProgress = true;
  const generation = topicGeneration;
  try {
    const response = await fetch(new URL("/api/admin/interviews/settings?scenario_id=interview", apiBase), { cache: "no-store" });
    if (!response.ok) throw new Error(await responseDetail(response));
    const payload: unknown = await response.json();
    if (!isInterviewTopicSettings(payload)) throw new Error("Неизвестный формат настроек интервью.");
    if (!disposed && generation === topicGeneration) renderTopic(payload);
  } catch (error) {
    if (!disposed && generation === topicGeneration) {
      topicStatus.textContent = error instanceof Error ? error.message : "Не удалось загрузить темы.";
      topicStatus.classList.add("is-error");
    }
  } finally {
    topicRequestInProgress = false;
  }
}

async function setTopic(topic: string | null): Promise<void> {
  if (disposed || topicWriteInProgress) return;
  topicWriteInProgress = true; topicGeneration++;
  topicSelect.disabled = true; topicStatus.textContent = "Сохраняем тему…";
  try {
    const response = await fetch(new URL("/api/admin/interviews/settings?scenario_id=interview", apiBase), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }),
    });
    if (!response.ok) throw new Error(await responseDetail(response));
    const payload: unknown = await response.json();
    if (!isInterviewTopicSettings(payload)) throw new Error("Неизвестный формат настроек интервью.");
    if (!disposed) renderTopic(payload);
  } catch (error) {
    if (!disposed) {
      if (topicSettings) renderTopic(topicSettings);
      topicStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить тему.";
      topicStatus.classList.add("is-error");
    }
  } finally {
    topicWriteInProgress = false;
    if (!disposed) topicSelect.disabled = topicSettings === null;
  }
}

topicSelect.addEventListener("change", () => void setTopic(topicSelect.value || null));

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
void refreshTopic();
const poll = window.setInterval(() => { void refresh(); void refreshTopic(); }, 2000);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    window.clearInterval(poll);
  });
}
