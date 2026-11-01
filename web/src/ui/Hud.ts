import { logout } from "../auth";

export class Hud {
  private readonly root: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly buttonLabel: HTMLElement;
  private readonly error: HTMLElement;
  private readonly promptElement: HTMLElement;
  private readonly roomName: HTMLElement;
  private readonly hint: HTMLElement;

  private started = false;
  private interviewMode = false;
  private conversationOpen = false;

  constructor(mount: HTMLElement, onEnter: () => void) {
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <div class="hud__crosshair" aria-hidden="true"></div>
      <div class="hud__prompt" style="position: absolute; top: 58%; left: 50%; transform: translate(-50%, -50%); color: white; font-family: sans-serif; font-size: 16px; background: rgba(0,0,0,0.6); padding: 6px 14px; border-radius: 4px; display: none; pointer-events: none;"></div>

      <header class="hud__brand">
        <span class="hud__brand-copy">
          <strong>ЗаявиСебя</strong>
        </span>
      </header>
      <div class="hud__meta">
        <span data-room-name>Офис</span>
      </div>
      <div class="hud__hint">WASD — движение&ensp;·&ensp;Shift — бег&ensp;·&ensp;E — взаимодействие&ensp;·&ensp;Esc — пауза</div>
      <section class="hud__overlay" aria-label="Старт">
        <div class="start">
          <p class="start__eyebrow">Игровой тренажёр собеседований</p>
          <h1 class="start__title">Офис</h1>
          <p class="start__text">
            Практикуйте собеседования в виртуальном офисе: общайтесь с персонажами
            и оттачивайте ответы в спокойной обстановке.
          </p>
          <button class="start__button" type="button">
            <span class="start__button-label">Войти</span>
            <kbd>клик</kbd>
          </button>
          <ul class="start__controls">
            <li><kbd>W A S D</kbd><span>движение</span></li>
            <li><kbd>Shift</kbd><span>бег</span></li>
            <li><kbd>Мышь</kbd><span>обзор</span></li>
            <li><kbd>Esc</kbd><span>пауза</span></li>
          </ul>
          <button class="start__logout" type="button">Выйти из аккаунта</button>
          <p class="start__error" role="alert" hidden></p>
        </div>
      </section>
    `;

    mount.appendChild(root);
    this.root = root;

    const overlay = root.querySelector<HTMLElement>(".hud__overlay");
    const eyebrow = root.querySelector<HTMLElement>(".start__eyebrow");
    const title = root.querySelector<HTMLElement>(".start__title");
    const description = root.querySelector<HTMLElement>(".start__text");
    const buttonLabel = root.querySelector<HTMLElement>(".start__button-label");
    const error = root.querySelector<HTMLElement>(".start__error");
    const promptElement = root.querySelector<HTMLElement>(".hud__prompt");
    const roomName = root.querySelector<HTMLElement>("[data-room-name]");
    const hint = root.querySelector<HTMLElement>(".hud__hint");

    if (!overlay || !eyebrow || !title || !description || !buttonLabel || !error || !promptElement ||
        !roomName || !hint) {
      throw new Error("HUD: не удалось создать разметку");
    }

    this.overlay = overlay;
    this.eyebrow = eyebrow;
    this.title = title;
    this.description = description;
    this.buttonLabel = buttonLabel;
    this.error = error;
    this.promptElement = promptElement;
    this.roomName = roomName;
    this.hint = hint;

    root.querySelector<HTMLButtonElement>(".start__logout")!.addEventListener("click", (event) => {
      event.stopPropagation();
      void logout().catch((reason: unknown) => this.showError(reason instanceof Error ? reason.message : "Не удалось выйти"));
    });

    // Клик в любом месте заставки — вход (клик по кнопке всплывает сюда же).
    overlay.addEventListener("click", () => onEnter());
  }

  setPlaying(playing: boolean): void {
    if (this.interviewMode || this.conversationOpen) return;
    this.root.classList.toggle("is-playing", playing);

    if (playing) {
      this.started = true;
      this.overlay.setAttribute("aria-hidden", "true");
      return;
    }

    this.overlay.setAttribute("aria-hidden", "false");
    this.error.hidden = true;

    if (!this.started) {
      return;
    }

    this.eyebrow.textContent = "Пауза";
    this.title.textContent = "Офис";
    this.description.textContent =
      "Сессия приостановлена. Кликните, чтобы вернуться в офис — позиция сохранится.";
    this.buttonLabel.textContent = "Продолжить";
    this.overlay.querySelector<HTMLButtonElement>(".start__button")?.focus({ preventScroll: true });
  }

  setInterviewMode(active: boolean): void {
    this.interviewMode = active;
    this.root.classList.toggle("is-interview", active);
    this.root.classList.remove("is-playing");
    this.overlay.setAttribute("aria-hidden", active ? "true" : "false");
    this.roomName.textContent = active ? "Сценарий" : "Офис";
    this.hint.textContent = active
      ? "Кабинет интервью · E — вернуться в офис"
      : "WASD — движение · Shift — бег · E — взаимодействие · Esc — пауза";
    if (active) this.error.hidden = true;
  }

  setConversationOpen(open: boolean): void {
    this.conversationOpen = open;
    this.root.classList.toggle("is-conversing", open);
    if (!open) {
      this.root.classList.remove("is-playing");
      this.overlay.setAttribute("aria-hidden", "false");
    }
  }

  public showPrompt(text: string): void {
    this.promptElement.innerText = text;
    this.promptElement.style.display = "block";
  }

  public hidePrompt(): void {
    this.promptElement.style.display = "none";
  }

  showError(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
  }

  dispose(): void {
    this.root.remove();
  }
}
