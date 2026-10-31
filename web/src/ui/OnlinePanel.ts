import type { GameClient, Scenario } from "../network/GameClient";

export class OnlinePanel {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly count: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly input: HTMLTextAreaElement;
  private readonly file: HTMLInputElement;
  private readonly result: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly reload: HTMLButtonElement;
  private busy = false;
  private connected = false;
  private hasScenarios = false;
  private loadingScenarios = false;
  private disposed = false;
  isOpen = false;

  constructor(mount: HTMLElement, private readonly client: GameClient, toggle: () => void) {
    this.root = document.createElement("section");
    this.root.className = "online";
    this.root.innerHTML = `
      <div class="online__summary">
        <span data-status role="status">Подключение…</span>
        <span data-count>Игроков: 0</span>
        <button type="button" data-toggle>NPC · E</button>
      </div>
      <section class="online__dialog" aria-label="Разговор с NPC" hidden>
        <h2>Собеседование с NPC</h2>
        <p>Напишите ответ или загрузите аудиозапись. NPC ответит текстом.</p>
        <button type="button" data-reload>Обновить сценарии</button>
        <form>
          <label>Сценарий<select aria-label="Сценарий" required></select></label>
          <label>Ваш ответ<textarea maxlength="1000" rows="4" required></textarea></label>
          <label>Аудиозапись<input type="file" accept="audio/wav,audio/x-wav,audio/wave,audio/webm,video/webm,audio/ogg,audio/mpeg,audio/mp4,audio/flac"></label>
          <button type="submit">Отправить</button>
        </form>
        <p data-result role="status" class="online__result"></p>
        <button type="button" data-close>Закрыть</button>
      </section>`;
    mount.appendChild(this.root);
    // Разметка полностью определяется классом, внешние строки вставляются textContent.
    this.panel = this.root.querySelector<HTMLElement>(".online__dialog")!;
    this.status = this.root.querySelector<HTMLElement>("[data-status]")!;
    this.count = this.root.querySelector<HTMLElement>("[data-count]")!;
    this.select = this.root.querySelector<HTMLSelectElement>("select")!;
    this.input = this.root.querySelector<HTMLTextAreaElement>("textarea")!;
    this.file = this.root.querySelector<HTMLInputElement>("input")!;
    this.result = this.root.querySelector<HTMLElement>("[data-result]")!;
    this.form = this.root.querySelector<HTMLFormElement>("form")!;
    this.reload = this.root.querySelector<HTMLButtonElement>("[data-reload]")!;
    this.root.querySelector("[data-toggle]")!.addEventListener("click", toggle);
    this.root.querySelector("[data-close]")!.addEventListener("click", toggle);
    this.reload.addEventListener("click", () => void this.loadScenarios());
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.file.addEventListener("change", () => { this.input.required = !this.file.files?.length; });
    this.updateControls();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.panel.hidden = !open;
    if (open) this.input.focus();
  }

  setStatus(message: string, connected: boolean): void {
    this.status.textContent = message;
    this.connected = connected;
    this.updateControls();
  }

  setPlayerCount(count: number): void {
    this.count.textContent = `Игроков: ${count}`;
  }

  async loadScenarios(): Promise<void> {
    if (this.loadingScenarios || this.disposed) return;
    this.loadingScenarios = true;
    this.updateControls();
    try {
      const scenarios: Scenario[] = await this.client.scenarios();
      if (this.disposed) return;
      this.select.replaceChildren(...scenarios.map((scenario) => {
        const option = document.createElement("option");
        option.value = scenario.id;
        option.textContent = scenario.title;
        return option;
      }));
      this.hasScenarios = scenarios.length > 0;
      if (!this.hasScenarios) this.result.textContent = "На сервере нет доступных сценариев.";
    } catch (error) {
      if (!this.disposed) this.result.textContent = this.errorMessage(error);
    } finally {
      this.loadingScenarios = false;
      this.updateControls();
    }
  }

  private async send(): Promise<void> {
    if (this.busy || !this.connected || !this.hasScenarios) return;
    const file = this.file.files?.[0];
    const scenarioId = this.select.value;
    let message = this.input.value.trim();
    if (!file && !message) return;
    if (!file && message.length > 1000) {
      this.result.textContent = "Сократите ответ до 1000 символов.";
      return;
    }
    this.busy = true;
    this.result.textContent = file ? "Распознавание аудио…" : "NPC готовит ответ…";
    this.updateControls();
    try {
      if (file) {
        const response = await this.client.transcribe(file);
        if (this.disposed) return;
        message = response.text.trim();
        this.input.value = message;
        this.file.value = "";
        this.input.required = true;
        if (!message) throw new Error("Речь не распознана. Попробуйте другую запись.");
        if (message.length > 1000) throw new Error("Сократите распознанный текст до 1000 символов и отправьте снова.");
        this.result.textContent = "NPC готовит ответ…";
      }
      const response = await this.client.chat(scenarioId, message);
      if (!this.disposed) this.result.textContent = response.reply;
    } catch (error) {
      if (!this.disposed) this.result.textContent = this.errorMessage(error);
    } finally {
      this.busy = false;
      this.updateControls();
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Не удалось получить ответ сервера";
  }

  private updateControls(): void {
    this.reload.disabled = this.busy || this.loadingScenarios || !this.connected;
    for (const element of this.form.elements) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement || element instanceof HTMLButtonElement) {
        element.disabled = this.busy || !this.connected || !this.hasScenarios;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.remove();
  }
}
