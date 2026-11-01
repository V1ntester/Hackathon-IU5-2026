const INTERVIEW_QUESTION =
  "Расскажите о проекте, которым вы гордитесь. Какую задачу вы решали и что именно сделали для достижения результата?";

export class InterviewPanel {
  private readonly root: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly exit: HTMLButtonElement;
  private answered = false;

  constructor(mount: HTMLElement, onExit: () => void) {
    this.root = document.createElement("section");
    this.root.className = "interview";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Вопрос собеседования");
    this.root.innerHTML = `
      <form class="interview__panel">
        <p class="start__eyebrow interview__eyebrow">Собеседование · вопрос 1</p>
        <h2 class="interview__question">${INTERVIEW_QUESTION}</h2>
        <textarea
          class="interview__answer"
          aria-label="Ваш ответ"
          placeholder="Введите ваш ответ…"
          maxlength="2000"
          rows="5"
          required
        ></textarea>
        <p class="interview__status" role="status"></p>
        <div class="interview__actions">
          <button class="interview__button interview__button--primary" type="submit">
            Сохранить ответ
          </button>
          <button class="interview__button interview__button--secondary" type="button" disabled>
            Вернуться в офис (E)
          </button>
        </div>
      </form>`;
    mount.appendChild(this.root);

    this.form = this.root.querySelector<HTMLFormElement>("form")!;
    this.input = this.root.querySelector<HTMLTextAreaElement>("textarea")!;
    this.status = this.root.querySelector<HTMLElement>(".interview__status")!;
    this.submit = this.root.querySelector<HTMLButtonElement>("button[type='submit']")!;
    this.exit = this.root.querySelector<HTMLButtonElement>("button[type='button']")!;

    this.form.addEventListener("submit", this.saveAnswer);
    this.input.addEventListener("input", this.onAnswerChanged);
    this.exit.addEventListener("click", onExit);
  }

  get canExit(): boolean {
    return this.answered;
  }

  setActive(active: boolean): void {
    this.root.hidden = !active;
    if (!active) return;

    this.answered = false;
    this.form.reset();
    this.submit.disabled = false;
    this.exit.disabled = true;
    this.status.textContent = "Ответьте на вопрос, чтобы разблокировать выход.";
    this.input.focus({ preventScroll: true });
  }

  dispose(): void {
    this.root.remove();
  }

  private readonly saveAnswer = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!this.input.value.trim()) {
      this.status.textContent = "Введите ответ на вопрос перед сохранением.";
      this.input.focus({ preventScroll: true });
      return;
    }

    this.answered = true;
    this.submit.disabled = true;
    this.exit.disabled = false;
    this.status.textContent = "Ответ сохранён. Теперь можно вернуться в офис.";
    this.exit.focus({ preventScroll: true });
  };

  private readonly onAnswerChanged = (): void => {
    if (!this.answered) return;

    this.answered = false;
    this.submit.disabled = false;
    this.exit.disabled = true;
    this.status.textContent = "Сохраните изменённый ответ, чтобы выйти.";
  };
}
