import type { GameClient } from "../network/GameClient";
import { VoiceRecorder } from "../player/VoiceRecorder";

const SCENARIO_ID = "interview";

export class InterviewPanel {
  private readonly root: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly messages: HTMLElement;
  private readonly voiceStatus: HTMLElement;
  private readonly microphone: HTMLButtonElement;
  private readonly composer: HTMLElement;
  private readonly inputHint: HTMLElement;
  private readonly voice: VoiceRecorder;
  private active = false;
  private connected = false;
  private busy = false;
  private recording = false;
  private greeted = false;
  private greetingStarted = false;
  private disposed = false;
  private generation = 0;
  private operation: AbortController | null = null;
  private scenarioTitle = "Собеседование";
  private greetingReply: HTMLElement | null = null;
  private pendingDraft: string | null = null;

  constructor(mount: HTMLElement, private readonly client: GameClient, onExit: () => void) {
    this.root = document.createElement("section");
    this.root.className = "interview";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Диалог собеседования");
    this.root.innerHTML = `
      <form class="interview__panel">
        <p class="start__eyebrow interview__eyebrow">Собеседование</p>
        <h2 class="interview__question">Разговор с рекрутером</h2>
        <div class="interview__messages" role="log" aria-label="Сообщения собеседования" aria-live="polite"></div>
        <div class="interview__composer">
          <textarea class="interview__answer" aria-label="Сообщение для NPC"
            placeholder="Введите сообщение…" maxlength="1000" rows="2"></textarea>
          <button class="interview__microphone" type="button" aria-label="Начать запись голоса"
            title="Записать голос" aria-pressed="false">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3"/>
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>
            </svg>
          </button>
        </div>
        <p class="interview__input-hint">Enter — отправить · Shift + Enter — новая строка</p>
        <p class="interview__voice-status" role="status"></p>
        <p class="interview__status" role="status"></p>
        <div class="interview__actions">
          <button class="interview__button interview__button--secondary" type="button">
            Вернуться в офис (E)
          </button>
        </div>
      </form>`;
    mount.appendChild(this.root);

    this.form = this.root.querySelector<HTMLFormElement>("form")!;
    this.input = this.root.querySelector<HTMLTextAreaElement>("textarea")!;
    this.status = this.root.querySelector<HTMLElement>(".interview__status")!;
    this.messages = this.root.querySelector<HTMLElement>(".interview__messages")!;
    this.voiceStatus = this.root.querySelector<HTMLElement>(".interview__voice-status")!;
    this.microphone = this.root.querySelector<HTMLButtonElement>(".interview__microphone")!;
    this.composer = this.root.querySelector<HTMLElement>(".interview__composer")!;
    this.inputHint = this.root.querySelector<HTMLElement>(".interview__input-hint")!;
    this.voice = new VoiceRecorder((recording) => {
      this.recording = recording;
      this.microphone.setAttribute("aria-pressed", String(recording));
      const label = recording ? "Остановить запись" : "Начать запись голоса";
      this.microphone.setAttribute("aria-label", label);
      this.microphone.title = label;
      this.updateControls();
    });

    this.form.addEventListener("submit", (event) => { event.preventDefault(); });
    this.input.addEventListener("keydown", this.onInputKeyDown);
    this.microphone.addEventListener("click", () => {
      if (this.recording) this.voice.stop();
      else void this.recordVoice();
    });
    this.root.querySelector<HTMLButtonElement>(".interview__button")!.addEventListener("click", onExit);
    this.updateControls();
    void this.prepareMicrophone();
  }

  get canExit(): boolean {
    return this.active;
  }

  setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    if (!connected) {
      this.cancelOperation();
      if (this.active) this.status.textContent = "Нет связи с сервером. Ожидаем подключения…";
    } else if (this.active) {
      if (!this.greeted) this.startGreeting();
      else this.status.textContent = "Связь восстановлена.";
    }
    this.updateControls();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.root.hidden = !active;
    this.cancelOperation();
    if (active) {
      this.messages.replaceChildren();
      this.greetingReply = null;
      this.input.value = "";
      this.greeted = false;
      this.greetingStarted = false;
      if (this.connected) this.startGreeting();
      else this.status.textContent = "Ожидаем подключения к серверу…";
    }
    this.updateControls();
  }

  private startGreeting(): void {
    if (!this.active || !this.connected || this.busy || this.greetingStarted) return;
    this.greetingStarted = true;
    this.greetingReply?.remove();
    this.greetingReply = null;
    void this.sendMessage("Привет", true);
  }

  private readonly onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || !this.active || !this.connected || this.busy) return;
    if (!this.greeted) {
      this.startGreeting();
      return;
    }
    const message = this.input.value.trim();
    if (!message) return;
    if (message.length > 1000) {
      this.status.textContent = "Сократите сообщение до 1000 символов.";
      return;
    }
    void this.sendMessage(message, false);
  };

  private async sendMessage(message: string, greeting: boolean): Promise<void> {
    const generation = this.generation;
    if (!greeting) {
      this.pendingDraft = this.input.value;
      this.input.value = "";
    }
    const operation = this.beginOperation();
    this.status.textContent = "";
    const pending = this.appendMessage("Вы", message, true);
    const answer = this.appendMessage(this.scenarioTitle, "Готовит ответ…");
    const answerText = answer.querySelector("p")!;
    answer.setAttribute("aria-busy", "true");
    if (greeting) this.greetingReply = answer;
    try {
      if (greeting) {
        const scenarios = await this.client.scenarios(operation.signal);
        if (!this.isCurrent(generation)) {
          pending.remove();
          answer.remove();
          return;
        }
        const scenario = scenarios.find((item) => item.id === SCENARIO_ID);
        if (!scenario) throw new Error("Сценарий собеседования не найден.");
        this.scenarioTitle = scenario.title;
        answer.querySelector("strong")!.textContent = this.scenarioTitle;
      }
      const response = await this.client.chat(SCENARIO_ID, message, operation.signal);
      if (!this.isCurrent(generation)) {
        pending.remove();
        answer.remove();
        return;
      }
      answerText.textContent = response.reply;
      answer.setAttribute("aria-busy", "false");
      this.messages.scrollTop = this.messages.scrollHeight;
      this.pendingDraft = null;
      this.voiceStatus.textContent = "";
      this.greeted = true;
      this.status.textContent = "";
    } catch (error) {
      pending.remove();
      if (!this.isCurrent(generation)) {
        answer.remove();
        return;
      }
      answer.setAttribute("aria-busy", "false");
      answerText.textContent = this.errorMessage(error);
      if (greeting) this.greetingStarted = false;
      if (greeting) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "interview__button interview__button--secondary";
        retry.textContent = "Повторить приветствие";
        retry.addEventListener("click", () => this.startGreeting());
        answer.appendChild(retry);
      } else {
        this.input.value = this.pendingDraft ?? message;
        this.pendingDraft = null;
        this.status.textContent = "Нажмите Enter, чтобы повторить.";
      }
    } finally {
      if (this.isCurrent(generation)) this.finishOperation();
    }
  }

  private appendMessage(author: string, text: string, user = false): HTMLElement {
    const message = document.createElement("div");
    message.className = `interview__message${user ? " interview__message--user" : ""}`;
    const label = document.createElement("strong");
    label.textContent = author;
    const content = document.createElement("p");
    content.textContent = text;
    message.append(label, content);
    this.messages.appendChild(message);
    this.messages.scrollTop = this.messages.scrollHeight;
    return message;
  }

  private async prepareMicrophone(): Promise<void> {
    try {
      await this.voice.requestPermission();
    } catch (error) {
      if (!this.disposed) this.voiceStatus.textContent = this.errorMessage(error);
    }
  }

  private async recordVoice(): Promise<void> {
    if (!this.active || !this.connected || !this.greeted || this.busy) return;
    const generation = this.generation;
    const operation = this.beginOperation();
    this.voiceStatus.textContent = "Подключение микрофона…";
    try {
      const audio = await this.voice.record();
      if (!this.isCurrent(generation)) return;
      this.voiceStatus.textContent = "Распознаём речь…";
      const response = await this.client.transcribe(audio, operation.signal);
      if (!this.isCurrent(generation)) return;
      const text = response.text.trim();
      if (!text) throw new Error("Речь не распознана. Попробуйте ещё раз.");
      this.input.value = text;
      this.voiceStatus.textContent = text.length > 1000
        ? "Сократите распознанный текст до 1000 символов."
        : "Проверьте текст и нажмите Enter.";
    } catch (error) {
      if (this.isCurrent(generation)) this.voiceStatus.textContent = this.errorMessage(error);
    } finally {
      if (this.isCurrent(generation)) this.finishOperation();
    }
  }

  private beginOperation(): AbortController {
    this.operation = new AbortController();
    this.busy = true;
    this.updateControls();
    return this.operation;
  }

  private finishOperation(): void {
    this.operation = null;
    this.busy = false;
    this.updateControls();
    if (this.greeted) this.input.focus({ preventScroll: true });
    else this.greetingReply?.querySelector("button")?.focus({ preventScroll: true });
  }

  private cancelOperation(): void {
    if (this.pendingDraft !== null) {
      this.input.value = this.pendingDraft;
      this.pendingDraft = null;
    }
    if (this.busy) this.voiceStatus.textContent = "";
    this.generation += 1;
    this.operation?.abort();
    this.operation = null;
    this.voice.cancel();
    this.busy = false;
    this.greetingStarted = this.greeted;
    if (this.recording) this.recording = false;
    this.updateControls();
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.active && generation === this.generation;
  }

  private updateControls(): void {
    this.composer.hidden = !this.greeted;
    this.inputHint.hidden = !this.greeted;
    this.input.disabled = !this.active || !this.connected || this.busy;
    this.microphone.disabled = !this.active || !this.connected || !this.greeted ||
      (this.busy && !this.recording);
    if (this.recording) this.voiceStatus.textContent = "Идёт запись. Нажмите микрофон, чтобы закончить.";
    this.form.setAttribute("aria-busy", String(this.busy));
  }

  private errorMessage(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "SecurityError") {
        return "Разрешите микрофон в настройках сайта или используйте текстовый ввод.";
      }
      if (error.name === "NotFoundError") return "Микрофон не найден. Можно ввести сообщение текстом.";
      if (error.name === "NotReadableError") return "Микрофон недоступен или занят другим приложением.";
    }
    return error instanceof Error ? error.message : "Не удалось получить ответ сервера.";
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.cancelOperation();
    this.voice.dispose();
    this.root.remove();
  }
}
