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
    const response = await fetch(new URL(path, this.base), {
      ...init,
      signal: this.abort.signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
      throw new Error(typeof detail === "string" ? detail : `Ошибка сервера (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  async connect(): Promise<void> {
    if (this.disposed || this.connecting || this.socket) return;
    this.connecting = true;
    this.callbacks.status("Подключение к серверу…", false);
    try {
      // Профиль принадлежит экземпляру страницы: две вкладки получают разные UUID.
      if (!this.playerId) {
        const player = await this.request<{ id: string }>("/api/players", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: "Гость" }),
        });
        this.playerId = player.id;
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

  scenarios(): Promise<Scenario[]> {
    return this.request("/api/scenarios");
  }

  chat(scenarioId: string, message: string): Promise<{ reply: string }> {
    if (!this.playerId) return Promise.reject(new Error("Дождитесь подключения к серверу"));
    return this.request("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: this.playerId, scenario_id: scenarioId, message }),
    });
  }

  transcribe(file: File): Promise<{ text: string }> {
    if (!this.playerId) return Promise.reject(new Error("Дождитесь подключения к серверу"));
    const body = new FormData();
    body.append("player_id", this.playerId);
    body.append("file", file);
    return this.request("/api/ai/transcribe", { method: "POST", body });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.retry);
    this.abort.abort();
    this.socket?.close();
    this.socket = null;
  }
}
