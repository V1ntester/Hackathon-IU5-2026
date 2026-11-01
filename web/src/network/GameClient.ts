import { isWorldObjectState, type WorldObjectState } from "./WorldObjectState";
import { isServerEvent, type ServerEvent } from "./ServerEvent";

export interface PlayerState {
  id: string;
  display_name: string;
  position: { x: number; y: number; z: number };
  rotation_y: number;
  last_interaction_object_id?: string | null;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
}

export interface DialogueTurn {
  sequence: number;
  request_id: string;
  message: string;
  reply: string | null;
  status: "pending" | "completed" | "failed";
}

export interface InterviewState {
  id: string;
  status: "in_progress" | "ready_for_evaluation" | "evaluating" | "completed" | "evaluation_failed";
  answered: number;
  evaluated: number;
  total: number;
  current_question: { position: number; text: string } | null;
}

interface Callbacks {
  status: (message: string, connected: boolean) => void;
  state: (players: PlayerState[], localId: string) => void;
  objects?: (objects: WorldObjectState[]) => void;
  connected: () => void;
  event?: (event: ServerEvent) => void;
}

export class GameClient {
  private readonly base = new URL(import.meta.env.VITE_BACKEND_URL || location.origin);
  private readonly abort = new AbortController();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private playerId: string | null = null;
  private disposed = false;
  private connecting = false;

  constructor(private readonly callbacks: Callbacks) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    const signals = [this.abort.signal, init.signal];
    for (const signal of signals) {
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) controller.abort();
    }
    try {
      const response = await fetch(new URL(path, this.base), { ...init, signal: controller.signal });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
        throw new Error(typeof detail === "string" ? detail : `Ошибка сервера (${response.status})`);
      }
      return await response.json() as T;
    } finally {
      for (const signal of signals) signal?.removeEventListener("abort", cancel);
    }
  }

  async connect(): Promise<void> {
    if (this.disposed || this.connecting || this.socket) return;
    this.connecting = true;
    this.callbacks.status("Подключение к серверу…", false);
    try {
      // sessionStorage сохраняет гостя при обновлении страницы в этой вкладке.
      this.playerId ??= sessionStorage.getItem(`guest:${this.base.origin}`);
      if (!this.playerId) {
        const player = await this.request<{ id: string }>("/api/players", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: "Гость" }),
        });
        this.playerId = player.id;
        sessionStorage.setItem(`guest:${this.base.origin}`, player.id);
      }
      if (this.disposed) return;
      const url = new URL(`/ws/${this.playerId}`, this.base);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        if (this.disposed) return;
        this.callbacks.status("Соединение установлено", true);
        this.callbacks.connected();
      };
      socket.onmessage = (event: MessageEvent) => {
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (isServerEvent(message)) {
            this.callbacks.event?.(message);
            return;
          }
          if (!message || typeof message !== "object") return;
          const state = message as { type: string; players: PlayerState[]; objects?: unknown };
          if (state.type !== "state" || !Array.isArray(state.players)) return;
          const valid = state.players.every((player) =>
            typeof player.id === "string" && typeof player.display_name === "string" &&
            player.position && [player.position.x, player.position.y, player.position.z,
              player.rotation_y].every((value) => typeof value === "number" && Number.isFinite(value)));
          if (valid && this.playerId) {
            this.callbacks.state(state.players, this.playerId);
            if (Array.isArray(state.objects) && state.objects.every(isWorldObjectState)) {
              this.callbacks.objects?.(state.objects);
            }
          }
        } catch {
          this.callbacks.status("Получено некорректное состояние комнаты", false);
        }
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        if (this.disposed) return;
        this.callbacks.state([], this.playerId ?? "");
        this.callbacks.status("Связь потеряна. Переподключение…", false);
        this.scheduleRetry();
      };
      socket.onerror = () => {
        if (!this.disposed) this.callbacks.status("Игровой сервер недоступен", false);
      };
    } catch (error) {
      if (!this.disposed) {
        this.callbacks.status(error instanceof Error ? error.message : "Ошибка подключения", false);
        this.scheduleRetry();
      }
    } finally {
      this.connecting = false;
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.connect(), 2000);
  }

  sendMove(position: PlayerState["position"], rotationY: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 0) return;
    // Babylon допускает накопленный yaw, сервер принимает ограниченный диапазон.
    const yaw = Math.atan2(Math.sin(rotationY), Math.cos(rotationY));
    this.socket.send(JSON.stringify({ type: "move", position, rotation_y: yaw }));
  }

  sendInteract(objectId: string): boolean {
    const id = objectId.trim();
    if (!id || [...id].length > 100) throw new Error("Некорректный идентификатор объекта");
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 0) return false;
    this.socket.send(JSON.stringify({ type: "interact", object_id: id }));
    return true;
  }

  scenarios(signal?: AbortSignal): Promise<Scenario[]> {
    return this.request("/api/scenarios", { signal });
  }

  chat(scenarioId: string, message: string, conversationId: string, requestId: string, signal?: AbortSignal): Promise<{ reply: string }> {
    if (!this.playerId) return Promise.reject(new Error("Дождитесь подключения к серверу"));
    return this.request("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: this.playerId, scenario_id: scenarioId, message,
        conversation_id: conversationId, request_id: requestId }),
      signal,
    });
  }

  practiceKey(kind: string, scenarioId: string): string {
    if (!this.playerId) throw new Error("Дождитесь подключения к серверу");
    return `${this.base.origin}:${this.playerId}:${scenarioId}:${kind}`;
  }

  private identity(scenarioId: string): { player_id: string; scenario_id: string } {
    if (!this.playerId) throw new Error("Дождитесь подключения к серверу");
    return { player_id: this.playerId, scenario_id: scenarioId };
  }

  private post<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
    return this.request(path, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal });
  }

  private identityQuery(scenarioId: string): string {
    return new URLSearchParams(this.identity(scenarioId)).toString();
  }

  async conversation(scenarioId: string, fresh = false): Promise<string> {
    const key = this.practiceKey("conversation", scenarioId);
    if (fresh) sessionStorage.removeItem(key);
    const saved = JSON.parse(sessionStorage.getItem(key) || "null") as { id?: string; request: string } | null;
    if (saved?.id) return saved.id;
    const request = saved?.request ?? crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ request }));
    const result = await this.post<{ id: string }>("/api/conversations", {
      ...this.identity(scenarioId), request_id: request });
    const latest = JSON.parse(sessionStorage.getItem(key) || "null") as { request?: string } | null;
    if (latest?.request === request) sessionStorage.setItem(key, JSON.stringify({ request, id: result.id }));
    return result.id;
  }

  turns(scenarioId: string, id: string, after = 0): Promise<DialogueTurn[]> {
    return this.request(`/api/conversations/${id}/turns?${this.identityQuery(scenarioId)}&after=${after}&limit=100`);
  }

  async interview(scenarioId: string, fresh = false): Promise<InterviewState> {
    const key = this.practiceKey("interview", scenarioId);
    if (fresh) sessionStorage.removeItem(key);
    const saved = JSON.parse(sessionStorage.getItem(key) || "null") as { id?: string; request: string } | null;
    if (saved?.id) return this.interviewState(scenarioId, saved.id);
    const request = saved?.request ?? crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ request }));
    const state = await this.post<InterviewState>("/api/interviews", { ...this.identity(scenarioId), request_id: request });
    const latest = JSON.parse(sessionStorage.getItem(key) || "null") as { request?: string } | null;
    if (latest?.request === request) sessionStorage.setItem(key, JSON.stringify({ request, id: state.id }));
    return state;
  }

  interviewState(scenarioId: string, id: string): Promise<InterviewState> {
    return this.request(`/api/interviews/${id}?${this.identityQuery(scenarioId)}`);
  }

  answer(scenarioId: string, id: string, position: number, answer: string, requestId: string): Promise<InterviewState> {
    return this.post(`/api/interviews/${id}/answers`, { ...this.identity(scenarioId), position, answer, request_id: requestId });
  }

  evaluate(scenarioId: string, id: string, retry = false): Promise<InterviewState> {
    return this.post(`/api/interviews/${id}/${retry ? "retry-evaluation" : "evaluate"}`, this.identity(scenarioId));
  }

  report(scenarioId: string, id: string): Promise<{ status: string; report_text?: string }> {
    return this.request(`/api/interviews/${id}/report?${this.identityQuery(scenarioId)}`);
  }

  transcribe(file: File, signal?: AbortSignal): Promise<{ text: string }> {
    if (!this.playerId) return Promise.reject(new Error("Дождитесь подключения к серверу"));
    const body = new FormData();
    body.append("player_id", this.playerId);
    body.append("file", file);
    body.append("language", "ru");
    return this.request("/api/ai/transcribe", { method: "POST", body, signal });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.retry);
    this.abort.abort();
    this.socket?.close();
    this.socket = null;
  }
}
