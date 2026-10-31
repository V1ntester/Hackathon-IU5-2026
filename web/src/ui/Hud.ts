export class Hud {
  private readonly root: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly buttonLabel: HTMLElement;
  private readonly error: HTMLElement;

  private started = false;

  constructor(mount: HTMLElement, onEnter: () => void) {
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <div class="hud__crosshair" aria-hidden="true"></div>
      <header class="hud__brand">
        <span class="hud__mark">PH</span>
        <span class="hud__brand-copy">
          <strong>Corporate HQ</strong>
          <span>прототип сцены</span>
        </span>
      </header>
      <div class="hud__meta">
        <span>26 × 26 м</span>
        <span>офис · 1 этаж</span>
      </div>
      <div class="hud__hint">WASD — движение&ensp;·&ensp;Shift — бег&ensp;·&ensp;Esc — пауза</div>
      <section class="hud__overlay" aria-label="Старт">
        <div class="start">
          <p class="start__eyebrow">Прототип · октябрь 2026</p>
          <h1 class="start__title">Офис</h1>
          <p class="start__text">
            Квадратный опенспейс 26 × 26 метров. Панорамные окна, дневной свет
            и сетка прототипа — каркас для будущих моделей.
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

    if (!overlay || !eyebrow || !title || !description || !buttonLabel || !error) {
      throw new Error("HUD: не удалось создать разметку");
    }

    this.overlay = overlay;
    this.eyebrow = eyebrow;
    this.title = title;
    this.description = description;
    this.buttonLabel = buttonLabel;
    this.error = error;

    // Клик в любом месте заставки — вход (клик по кнопке всплывает сюда же).
    overlay.addEventListener("click", () => onEnter());
  }

  setPlaying(playing: boolean): void {
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

  showError(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
  }

  dispose(): void {
    this.root.remove();
  }
}
