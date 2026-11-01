export class OnlinePanel {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly count: HTMLElement;

  constructor(mount: HTMLElement) {
    this.root = document.createElement("section");
    this.root.className = "online";
    this.root.innerHTML = `
      <div class="online__summary">
        <span data-status role="status">Подключение…</span>
        <span data-count>Игроков: 0</span>
      </div>`;
    mount.appendChild(this.root);
    this.status = this.root.querySelector<HTMLElement>("[data-status]")!;
    this.count = this.root.querySelector<HTMLElement>("[data-count]")!;
  }

  setStatus(message: string): void {
    this.status.textContent = message;
  }

  setPlayerCount(count: number): void {
    this.count.textContent = `Игроков: ${count}`;
  }

  dispose(): void {
    this.root.remove();
  }
}
