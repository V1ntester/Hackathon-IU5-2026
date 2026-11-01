import type { GameClient, DialogueTurn } from "../network/GameClient";
import { VoiceRecorder } from "../player/VoiceRecorder";
import { createRequestId } from "../network/requestId";

const SCENARIO_ID = "interview";

export class NpcDialogPanel {
  private readonly root: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly messages: HTMLElement;
  private readonly send: HTMLButtonElement;
  private readonly microphone: HTMLButtonElement;
  private readonly fresh: HTMLButtonElement;
  private readonly voice: VoiceRecorder;
  private active = false;
  private connected = false;
  private disposed = false;
  private busy = false;
  private recording = false;
  private waiting = false;
  private generation = 0;
  private conversationId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { request: string; message: string } | null = null;

  constructor(mount: HTMLElement, private readonly client: GameClient, onExit: () => void) {
    this.root = document.createElement("section");
    this.root.className = "interview npc-dialog";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Разговор с NPC");
    this.root.innerHTML = `<form class="interview__panel">
      <p class="start__eyebrow">Диалог</p><h2 class="interview__question">Разговор с NPC</h2>
      <div class="interview__messages" role="log" aria-live="polite"></div>
      <textarea class="interview__answer" aria-label="Сообщение" maxlength="1000" rows="2"></textarea>
      <p class="interview__status" role="status"></p>
      <div class="interview__actions">
        <button type="submit" class="interview__button" data-send>Отправить</button>
        <button type="button" class="interview__button" data-voice>Микрофон</button>
        <button type="button" class="interview__button" data-new>Новый разговор</button>
        <button type="button" class="interview__button" data-refresh>Восстановить</button>
        <button type="button" class="interview__button" data-close>Закрыть (Esc)</button>
      </div></form>`;
    mount.appendChild(this.root);
    this.input = this.root.querySelector("textarea")!;
    this.status = this.root.querySelector(".interview__status")!;
    this.messages = this.root.querySelector(".interview__messages")!;
    this.send = this.root.querySelector("[data-send]")!;
    this.microphone = this.root.querySelector("[data-voice]")!;
    this.fresh = this.root.querySelector("[data-new]")!;
    this.voice = new VoiceRecorder((recording) => {
      this.recording = recording;
      this.microphone.textContent = recording ? "Остановить запись" : "Микрофон";
      this.controls();
    });
    this.root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault(); void this.submit();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) void this.submit();
      }
    });
    this.microphone.addEventListener("click", () => {
      if (this.recording) this.voice.stop(); else void this.record();
    });
    this.fresh.addEventListener("click", () => void this.restore(true));
    this.root.querySelector("[data-refresh]")!.addEventListener("click", () => void this.restore());
    this.root.querySelector("[data-close]")!.addEventListener("click", onExit);
    this.controls();
  }

  get isOpen(): boolean { return this.active; }

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (this.active && connected) void this.restore();
    if (!connected) { this.invalidate(); this.status.textContent = "Нет связи с сервером"; }
    this.controls();
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.root.hidden = !active;
    this.invalidate();
    if (active && this.connected) void this.restore();
    this.controls();
  }

  private invalidate(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.voice.cancel();
    this.busy = false;
  }

  private current(generation: number): boolean {
    return !this.disposed && this.active && this.connected && generation === this.generation;
  }

  private pendingKey(): string {
    return this.client.practiceKey(`pending:${this.conversationId}`, SCENARIO_ID);
  }

  private async restore(fresh = false): Promise<void> {
    if (!this.active || !this.connected || this.busy) return;
    this.invalidate();
    const generation = this.generation;
    if (fresh) {
      this.conversationId = null; this.pending = null; this.waiting = false;
      this.input.value = ""; this.messages.replaceChildren();
    }
    this.busy = true; this.controls();
    try {
      const id = await this.client.conversation(SCENARIO_ID, fresh);
      if (!this.current(generation)) return;
      if (id !== this.conversationId) this.input.value = "";
      this.conversationId = id;
      this.pending = JSON.parse(sessionStorage.getItem(this.pendingKey()) || "null") as typeof this.pending;
      const rows: DialogueTurn[] = [];
      let after = 0;
      while (true) {
        const page = await this.client.turns(SCENARIO_ID, id, after);
        if (!this.current(generation)) return;
        rows.push(...page);
        if (page.length < 100) break;
        after = page[page.length - 1]!.sequence;
      }
      this.messages.replaceChildren();
      for (const turn of rows) {
        this.append("Вы", turn.message);
        this.append("NPC", turn.reply ?? (turn.status === "pending" ? "Готовит ответ…" : "Ответ не получен"));
      }
      const unresolved = rows.find((r) => r.status === "pending");
      this.waiting = Boolean(unresolved);
      const last = rows[rows.length - 1];
      if (this.pending && rows.some((r) => r.request_id === this.pending!.request && r.status === "completed")) {
        this.pending = null; sessionStorage.removeItem(this.pendingKey()); this.input.value = "";
      }
      if (unresolved) {
        this.pending = { request: unresolved.request_id, message: unresolved.message };
        sessionStorage.setItem(this.pendingKey(), JSON.stringify(this.pending));
        this.status.textContent = "Ожидаем завершения реплики…";
        this.timer = setTimeout(() => void this.restore(), 2000);
      } else {
        // После серверного рестарта можно повторить failed-реплику с тем же ключом.
        if (!this.pending && last?.status === "failed") this.pending = { request: last.request_id, message: last.message };
        if (this.pending) this.input.value = this.pending.message;
        this.status.textContent = this.pending ? "Ответ не получен. Нажмите «Отправить» для повтора." : "Enter — отправить · Shift + Enter — новая строка";
      }
    } catch (error) {
      if (this.current(generation)) this.status.textContent = this.error(error);
    } finally {
      if (this.current(generation)) { this.busy = false; this.controls(); }
    }
  }

  private async submit(): Promise<void> {
    if (this.busy || this.waiting || !this.active || !this.connected || !this.conversationId) return;
    const message = this.input.value.trim();
    if (!message || [...message].length > 1000) return;
    const id = this.conversationId, generation = this.generation;
    const pending = this.pending?.message === message ? this.pending : { request: createRequestId(), message };
    this.pending = pending;
    sessionStorage.setItem(this.pendingKey(), JSON.stringify(pending));
    this.busy = true; this.controls(); this.status.textContent = "Готовит ответ…";
    let failure = "";
    try {
      await this.client.chat(SCENARIO_ID, message, id, pending.request);
      if (!this.current(generation)) return;
      this.input.value = "";
    } catch (error) {
      failure = this.error(error);
    } finally {
      if (this.current(generation)) {
        this.busy = false;
        const restoredGeneration = this.generation + 1;
        await this.restore();
        if (this.current(restoredGeneration) && this.conversationId === id && failure && this.pending && !this.waiting) {
          this.status.textContent = `${failure}. Повторите отправку или создайте новый разговор.`;
        }
      }
    }
  }

  private append(author: string, text: string): void {
    const row = document.createElement("div"); row.className = "interview__message";
    const label = document.createElement("strong"); label.textContent = author;
    const content = document.createElement("p"); content.textContent = text;
    row.append(label, content); this.messages.appendChild(row);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private async record(): Promise<void> {
    if (this.busy || !this.active || !this.connected) return;
    const generation = this.generation;
    this.busy = true; this.controls();
    try {
      const audio = await this.voice.record();
      if (!this.current(generation)) return;
      this.status.textContent = "Распознаём речь…";
      const response = await this.client.transcribe(audio);
      if (this.current(generation)) this.input.value = response.text;
    } catch (error) {
      if (this.current(generation)) this.status.textContent = this.error(error);
    } finally {
      if (this.current(generation)) { this.busy = false; this.controls(); }
    }
  }

  private controls(): void {
    const disabled = !this.active || !this.connected || this.busy;
    this.input.disabled = disabled;
    this.send.disabled = disabled || this.waiting || !this.conversationId;
    this.microphone.disabled = !this.connected || !this.active || (this.busy && !this.recording);
    this.fresh.disabled = disabled;
  }

  private error(error: unknown): string { return error instanceof Error ? error.message : "Ошибка сервера"; }

  dispose(): void {
    this.disposed = true; this.invalidate(); this.voice.dispose(); this.root.remove();
  }
}
