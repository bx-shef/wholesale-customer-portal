# Настройки репозитория (разово, владельцу)

> Last reviewed: 2026-10-11

Перенесено из `bx-shef/invoice-from-tasks` (а туда — из эталона `client-bank-alfa-by`). Делается в интерфейсе GitHub один раз; агент
этого сделать не может и не должен (`docs/AGENT_RULES.md` §5.8).

## Состояние (2026-10-11)

Ничего не сверялось: репозиторий новый. Проверка §1 — без токена:

```bash
curl -fsS https://api.github.com/repos/bx-shef/wholesale-customer-portal/rules/branches/main
```

| Пункт | Состояние |
| --- | --- |
| §1 Защита `main`, проверки `ci` и `docker-build` | ⏳ не настроено |
| §2 Удаление веток после мержа | ⏳ |
| §3 Dependabot | ⏳ |
| §4 Пакет GHCR публичный | ⏳ пакет появится с первым выкатом в `main`; сделать публичным (решение владельца 2026-10-11) |

Таблица ведётся руками: поменяли настройку — обновите строку и дату.

## 1. Защита `main` — ruleset `protect-main`

Settings → Rules → Rulesets → New branch ruleset:

- **Enforcement:** Active; **Bypass list:** пусто; **Target:** default branch.
- **Restrict deletions** и **Block force pushes** — включить.
- **Require a pull request before merging** — включить; approvals — 0 или 1; «Dismiss stale
  approvals» и «Require conversation resolution» — включить; **Allowed merge methods** — только
  Squash (мержим squash-коммитом, `docs/AGENT_RULES.md` §4.1).
- **Require status checks to pass** — включить, проверки **`ci`** и **`docker-build`**, «Require
  branches to be up to date» — включить. `docker-build` обязателен с тех пор, как `main` выкатывается
  в GHCR (`docs/DEPLOY.md`): PR с несобираемым образом иначе влился бы, и выкат молча встал бы на
  всех следующих мержах.

⚠ Имена джоб `ci` и `docker-build` — то, на что ссылается правило. Переименуете джобу — правило
продолжит ждать проверку со старым именем, и каждый PR встанет на «Expected — Waiting for status to
be reported» без возможности мержа. Имена стережёт `tests/repoGuards.test.ts`; переименовывать —
только вместе с правилом.

Проверка: попытка `git push --force` в `main` и удаление ветки должны отклоняться.

## 2. Ветки

Settings → General → **Automatically delete head branches** — включить.

## 3. Dependabot

Settings → Code security: alerts, security updates, version updates — включить.
Конфигурация — `.github/dependabot.yml` (группы `nuxt`, `b24`, `dev-deps`, actions, docker).

## 4. Пакет GHCR

Первый push в `main` после выката (джоба `deploy`) создаст пакет `ghcr.io/bx-shef/wholesale-customer-portal`.
Сделать его публичным: профиль `bx-shef` на GitHub (это пользователь, не организация) → вкладка
**Packages** → `wholesale-customer-portal` → **Package settings** → **Change visibility** → Public. Тогда серверу
и Watchtower не нужен `docker login` (`docs/DEPLOY.md`).

Проверка: `docker pull ghcr.io/bx-shef/wholesale-customer-portal:latest` без логина проходит.

## 5. Жизненный цикл изменения

ветка от `main` → код + тесты + документация одним PR → `/code-review` + панель из пяти →
исправления в том же PR → зелёные `ci` и `docker-build` → squash-мерж → удаление ветки →
комментарий в issue.
Подробно — `docs/AGENT_RULES.md`.
