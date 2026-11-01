**Развёртывание локального ИИ для NPC**

Для работы игры используются две локальные нейросети:
- **Qwen3-4B-Instruct-2507 Q4_K_M** — генерация текстовых ответов NPC.
- **Whisper Base** — распознавание голосовых ответов игроков.

Обе модели работают через официальные Docker-образы `llama.cpp` и `whisper.cpp`. Веса в Git не загружаем, каждый скачивает их самостоятельно.

**1. Открываем PowerShell в корне проекта**, где находится `docker-compose.yaml`.

**2. Создаём папки для моделей:**

```powershell
mkdir models\llm -Force
mkdir models\whisper -Force
```

**3. Скачиваем Qwen (~2,5 ГБ):**

[Страница файла GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/blob/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf).

```powershell
curl.exe -fL --retry 3 -o models\llm\Qwen3-4B-Instruct-2507-Q4_K_M.gguf "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
```

**4. Скачиваем Whisper Base (~148 МБ):**

```powershell
curl.exe -fL --retry 3 -o models\whisper\ggml-base.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

Важно: используем именно `ggml-base.bin`, а не английскую версию `ggml-base.en.bin`.

**5. Загружаем Docker-образы:**

```powershell
docker compose pull llm stt
```

**6. Запускаем оба сервиса:**

```powershell
docker compose up -d --pull never llm stt
```

**7. Проверяем работу:**

```powershell
docker compose ps
curl.exe http://localhost:8081/health
```

Адреса API на компьютере, где запущен Docker:

- **LLM:** `http://localhost:8081/v1/chat/completions`
- **STT:** `http://localhost:8082/inference`

Для остановки:

```powershell
docker compose stop llm stt
```

После первоначальной загрузки моделей и Docker-образов интернет для работы ИИ не требуется. Необходимо только, чтобы Docker Desktop был запущен.

**Итог:** около 2,65 ГБ весов плюс Docker-образы. Для LLM заданы контекст 4096,
6 потоков CPU и один слот генерации; ускорение GPU не включено.

Если ИИ-сервисы уже подготовлены, повторно скачивать Whisper и образы не нужно.
Переход на новые веса Qwen, настройка `QWEN_MODEL` и пересоздание только `llm`
описаны в [руководстве backend](Backend.md#замена-ранее-установленной-модели).
