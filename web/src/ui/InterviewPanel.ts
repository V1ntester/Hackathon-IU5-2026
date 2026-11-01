/** Временная заглушка кабинета интервью; диалог с LLM находится в NpcDialogPanel. */
export class InterviewPanel {
  private readonly root: HTMLElement;
  private readonly exit: HTMLButtonElement;
  private active = false;

  constructor(mount: HTMLElement, onExit: () => void) {
    this.root = document.createElement("section");
    this.root.className = "interview interview-placeholder";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Кабинет интервью");
    this.root.innerHTML = `
      <div class="interview__panel">
        <p class="start__eyebrow interview__eyebrow">Собеседование</p>
        <h2 class="interview__question">Кабинет интервью</h2>
        <p class="interview__status">Собеседование временно недоступно.</p>
        <div class="interview__actions">
          <button class="interview__button interview__button--secondary" type="button">Вернуться в офис (E)</button>
        </div>
      </div>`;
    mount.appendChild(this.root);
    this.exit = this.root.querySelector<HTMLButtonElement>("button")!;
    this.exit.addEventListener("click", onExit);
  }

  get canExit(): boolean { return this.active; }

  setActive(active: boolean): void {
    this.active = active;
    this.root.hidden = !active;
    if (active) this.exit.focus({ preventScroll: true });
  }

  dispose(): void { this.root.remove(); }
}
