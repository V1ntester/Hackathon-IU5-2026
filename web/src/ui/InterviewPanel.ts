import type { GameClient, InterviewState } from "../network/GameClient";
import { createRequestId } from "../network/requestId";

const SCENARIO_ID = "interview";

export class InterviewPanel {
  private readonly root: HTMLElement;
  private readonly question: HTMLElement;
  private readonly topic: HTMLElement;
  private readonly status: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly report: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly skip: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly fresh: HTMLButtonElement;
  private active = false;
  private connected = false;
  private disposed = false;
  private busy = false;
  private generation = 0;
  private state: InterviewState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(mount: HTMLElement, private readonly client: GameClient, onExit: () => void) {
    this.root = document.createElement("section");
    this.root.className = "interview"; this.root.hidden = true;
    this.root.setAttribute("aria-label", "Интервью");
    this.root.innerHTML = `<div class="interview__panel">
      <p class="start__eyebrow">Техническое интервью</p>
      <p data-topic></p>
      <h2 class="interview__question"></h2>
      <textarea class="interview__answer" aria-label="Ваш ответ" maxlength="1000" rows="4"></textarea>
      <p class="interview__status" role="status"></p>
      <div class="interview__messages" data-report style="white-space:pre-wrap" tabindex="0"></div>
      <div class="interview__actions">
        <button class="interview__button" data-submit>Подтвердить ответ</button>
        <button class="interview__button" data-skip>Не знаю</button>
        <button class="interview__button" data-retry>Повторить неуспешные оценки</button>
        <button class="interview__button" data-refresh>Обновить</button>
        <button class="interview__button" data-new>Новое интервью</button>
        <button class="interview__button" data-exit>Вернуться в офис (E)</button>
      </div></div>`;
    mount.appendChild(this.root);
    this.question = this.root.querySelector("h2")!;
    this.topic = this.root.querySelector("[data-topic]")!;
    this.status = this.root.querySelector(".interview__status")!;
    this.input = this.root.querySelector("textarea")!;
    this.report = this.root.querySelector("[data-report]")!;
    this.submit = this.root.querySelector("[data-submit]")!;
    this.skip = this.root.querySelector("[data-skip]")!;
    this.retry = this.root.querySelector("[data-retry]")!;
    this.fresh = this.root.querySelector("[data-new]")!;
    this.submit.addEventListener("click", () => void this.answer(this.input.value.trim()));
    this.skip.addEventListener("click", () => void this.answer("Не знаю"));
    this.retry.addEventListener("click", () => void this.evaluate(true));
    this.fresh.addEventListener("click", () => void this.load(true));
    this.root.querySelector("[data-refresh]")!.addEventListener("click", () => void this.load());
    this.root.querySelector("[data-exit]")!.addEventListener("click", onExit);
    this.render();
  }

  get canExit(): boolean { return this.active; }

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) this.invalidate();
    if (this.active && connected) void this.load();
    this.render();
  }

  setActive(active: boolean): void {
    this.active = active; this.root.hidden = !active; this.invalidate();
    if (active && this.connected) void this.load();
    this.render();
  }

  private invalidate(): void { this.generation++; clearTimeout(this.timer); this.busy = false; }
  private current(generation: number): boolean {
    return !this.disposed && this.active && this.connected && generation === this.generation;
  }

  private async load(fresh = false): Promise<void> {
    if (this.busy || !this.active || !this.connected) return;
    this.invalidate(); const generation = this.generation;
    if (fresh) { this.state = null; this.input.value = ""; this.report.textContent = ""; }
    this.busy = true; this.render();
    try {
      const state = await this.client.interview(SCENARIO_ID, fresh);
      if (!this.current(generation)) return;
      const changed = this.state?.id !== state.id || this.state?.current_question?.position !== state.current_question?.position;
      this.state = state;
      if (changed) { this.input.value = ""; this.report.textContent = ""; }
      if (state.current_question && !this.input.value) {
        const key = this.client.practiceKey(`answer:${state.id}:${state.current_question.position}`, SCENARIO_ID);
        const pending = JSON.parse(sessionStorage.getItem(key) || "null") as { answer?: string } | null;
        this.input.value = pending?.answer ?? "";
      }
      this.busy = false; this.render();
      if (state.status === "ready_for_evaluation") { await this.evaluate(false); return; }
      if (state.status === "completed") {
        const result = await this.client.report(SCENARIO_ID, state.id);
        if (this.current(generation) && this.state.id === state.id) this.report.textContent = result.report_text ?? "";
      }
      if (state.status === "evaluating") this.timer = setTimeout(() => void this.load(), 2000);
    } catch (error) {
      if (this.current(generation)) this.status.textContent = this.error(error);
    } finally {
      if (this.current(generation)) { this.busy = false; this.controls(); }
    }
  }

  private async answer(answer: string): Promise<void> {
    const state = this.state, question = state?.current_question;
    if (this.busy || !this.connected || !state || !question || !answer || [...answer].length > 1000) return;
    const generation = this.generation;
    const key = this.client.practiceKey(`answer:${state.id}:${question.position}`, SCENARIO_ID);
    const saved = JSON.parse(sessionStorage.getItem(key) || "null") as { request: string; answer: string } | null;
    const pending = saved?.answer === answer ? saved : { request: createRequestId(), answer };
    sessionStorage.setItem(key, JSON.stringify(pending));
    this.busy = true; this.controls();
    try {
      const next = await this.client.answer(SCENARIO_ID, state.id, question.position, answer, pending.request);
      if (!this.current(generation)) return;
      sessionStorage.removeItem(key); this.state = next; this.input.value = "";
      this.busy = false; this.render();
      if (next.status === "ready_for_evaluation") await this.evaluate(false);
    } catch (error) {
      if (this.current(generation)) this.status.textContent = `${this.error(error)}. Нажмите «Обновить» для восстановления состояния.`;
    } finally {
      if (this.current(generation)) { this.busy = false; this.controls(); }
    }
  }

  private async evaluate(retry: boolean): Promise<void> {
    if (this.busy || !this.state || !this.connected) return;
    const generation = this.generation, id = this.state.id;
    this.busy = true; this.controls();
    try {
      const state = await this.client.evaluate(SCENARIO_ID, id, retry);
      if (!this.current(generation) || this.state.id !== id) return;
      this.state = state; this.busy = false; this.render();
      this.timer = setTimeout(() => void this.load(), 1000);
    } catch (error) {
      if (this.current(generation)) this.status.textContent = this.error(error);
    } finally {
      if (this.current(generation)) { this.busy = false; this.controls(); }
    }
  }

  private render(): void {
    const state = this.state;
    this.topic.textContent = state ? `Тема: ${state.topic ?? "Все темы"}` : "";
    this.question.textContent = state?.current_question
      ? `Вопрос ${state.current_question.position} из 4: ${state.current_question.text}` : "Интервью";
    this.status.textContent = !this.connected ? "Ожидаем подключения к серверу…"
      : !state ? "Загружаем интервью…"
      : state.status === "evaluating" ? `Оценено ${state.evaluated} из 4`
      : state.status === "evaluation_failed" ? `Оценено ${state.evaluated} из 4. Повторите неуспешные оценки.`
      : state.status === "completed" ? "Оценено 4 из 4. Отчёт готов."
      : state.status === "ready_for_evaluation" ? "Четыре ответа сохранены. Готовим оценивание…"
      : "Ответ после подтверждения изменить нельзя.";
    this.input.hidden = !state?.current_question;
    this.submit.hidden = this.skip.hidden = !state?.current_question;
    this.retry.hidden = state?.status !== "evaluation_failed";
    this.controls();
  }

  private controls(): void {
    const disabled = this.busy || !this.connected || !this.active;
    this.input.disabled = this.submit.disabled = this.skip.disabled = this.retry.disabled = this.fresh.disabled = disabled;
  }
  private error(error: unknown): string { return error instanceof Error ? error.message : "Ошибка сервера"; }
  dispose(): void { this.disposed = true; this.invalidate(); this.root.remove(); }
}
