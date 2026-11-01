const LAST_NPC_MESSAGE = "Здравствуйте! Рад вас видеть. О чём хотите поговорить?";

export class NpcDialogPanel {
  private readonly root: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly status: HTMLElement;

  constructor(mount: HTMLElement, onClose: () => void) {
    this.root = document.createElement("section");
    this.root.className = "interview npc-dialog";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Разговор с NPC");
    this.root.innerHTML = `
      <form class="interview__panel">
        <p class="start__eyebrow interview__eyebrow">Разговор с NPC</p>
        <h2 class="interview__question">${LAST_NPC_MESSAGE}</h2>
        <textarea
          class="interview__answer"
          aria-label="Сообщение для NPC"
          placeholder="Напишите сообщение…"
          maxlength="1000"
          rows="4"
          required
        ></textarea>
        <p class="interview__status" role="status"></p>
        <div class="interview__actions">
          <button class="interview__button interview__button--primary" type="submit">
            Отправить
          </button>
          <button class="interview__button interview__button--secondary" type="button">
            Закрыть (Esc)
          </button>
        </div>
      </form>`;
    mount.appendChild(this.root);

    this.input = this.root.querySelector<HTMLTextAreaElement>("textarea")!;
    this.status = this.root.querySelector<HTMLElement>(".interview__status")!;
    this.root.querySelector<HTMLFormElement>("form")!.addEventListener("submit", this.onSubmit);
    this.root.querySelector<HTMLButtonElement>("button[type='button']")!.addEventListener("click", onClose);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  setActive(active: boolean): void {
    this.root.hidden = !active;
    if (!active) return;

    this.status.textContent = "";
    this.input.focus({ preventScroll: true });
  }

  dispose(): void {
    this.root.remove();
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.status.textContent = this.input.value.trim()
      ? "ИИ пока не подключён, поэтому ответ NPC недоступен."
      : "Введите сообщение для NPC.";
  };
}
