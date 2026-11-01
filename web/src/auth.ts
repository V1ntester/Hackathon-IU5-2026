import "./auth.css";

const base = new URL(import.meta.env.VITE_BACKEND_URL || location.origin);
const key = `auth:${base.origin}`;
export const sessionId = (): string => localStorage.getItem(key) || "";

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sessionId()}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    localStorage.removeItem(key);
    location.reload();
  }
  return response;
}

export interface Account { id: string; nickname: string; role: "admin" | "guest" }

export async function ensureAuth(): Promise<Account> {
  if (sessionId()) {
    const response = await fetch(new URL("/api/auth/me", base), {
      headers: { Authorization: `Bearer ${sessionId()}` },
    });
    if (response.ok) return await response.json() as Account;
    if (response.status !== 401) throw new Error("Сервис авторизации недоступен. Обновите страницу позже.");
    localStorage.removeItem(key);
  }
  return new Promise((resolve) => {
    const panel = document.createElement("section");
    panel.className = "auth-screen";
    panel.innerHTML = `<form class="auth-form"><h1>ЗаявиСебя</h1><p data-heading>Вход в аккаунт</p>
      <label>Ник<input name="nickname" required maxlength="40" autocomplete="username" pattern="[a-zA-Z0-9_а-яА-ЯёЁ-]+"></label>
      <label>Пароль<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
      <p data-error role="alert"></p><button type="submit">Войти</button>
      <button type="button" data-switch>Создать аккаунт</button></form>`;
    document.body.append(panel);
    const form = panel.querySelector("form")!;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const toggle = form.querySelector<HTMLButtonElement>("[data-switch]")!;
    const error = form.querySelector<HTMLElement>("[data-error]")!;
    const password = form.querySelector<HTMLInputElement>('[name="password"]')!;
    let register = false;
    toggle.onclick = () => {
      register = !register;
      form.querySelector("[data-heading]")!.textContent = register ? "Регистрация" : "Вход в аккаунт";
      submit.textContent = register ? "Зарегистрироваться" : "Войти";
      toggle.textContent = register ? "Уже есть аккаунт" : "Создать аккаунт";
      password.autocomplete = register ? "new-password" : "current-password";
      error.textContent = "";
    };
    form.onsubmit = async (event) => {
      event.preventDefault(); submit.disabled = true; toggle.disabled = true; error.textContent = "";
      try {
        const data = new FormData(form);
        const response = await fetch(new URL(`/api/auth/${register ? "register" : "login"}`, base), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: data.get("nickname"), password: data.get("password") }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Проверьте ник и пароль");
        localStorage.setItem(key, result.session_id);
        panel.remove(); resolve(result.user as Account);
      } catch (reason) { error.textContent = reason instanceof Error ? reason.message : "Не удалось войти"; }
      finally { submit.disabled = false; toggle.disabled = false; }
    };
  });
}

export async function logout(): Promise<void> {
  const response = await authFetch(new URL("/api/auth/logout", base), { method: "POST" });
  if (!response.ok) throw new Error("Не удалось выйти. Повторите попытку.");
  localStorage.removeItem(key);
  location.href = "/";
}
