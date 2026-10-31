# Хакатон ИУ5 октябрь 2026 команда Punk Hazard

Backend игры: Python 3.11+, FastAPI, PostgreSQL, SQLAlchemy и Alembic.
Подключение гостевое, без авторизации. NPC отвечает текстом через локальный Qwen;
локальный Whisper преобразует аудиозаписи в текст.

Инструкция по настройке, схема данных и протокол обмена: [Backend](docs/Backend.md).

Фактический фронтенд: Babylon.js, TypeScript и Vite, исходники в `web/`.
Подключены гостевой вход, синхронизация игроков и диалог с NPC через backend.
Устройство и настройка клиента: [Frontend](docs/Frontend.md).
Общая схема компонентов и API: [Архитектура](docs/Architecture_And_API.md).
