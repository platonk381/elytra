# Бот поддержки Elytra (Telegram + чат в лаунчере)

Игрок пишет в Elytra (или боту в Telegram), а сообщение приходит тебе в Telegram.
Ты нажимаешь на сообщение → «Ответить» и пишешь текст, и ответ приходит игроку туда, откуда он писал.

## Настройка (один раз, ~10 минут, бесплатно)

### 1. Создай бота
1. В Telegram открой **@BotFather** и отправь `/newbot`.
2. Придумай имя (например, `Elytra Support`) и username (например, `ElytraHelpBot`).
3. BotFather пришлёт **токен** вида `123456:ABC...`. Сохрани его.

### 2. Создай Worker на Cloudflare
1. Зарегистрируйся на **dash.cloudflare.com** (бесплатно, карта не нужна).
2. Слева выбери **Compute (Workers)** → **Workers & Pages** → **Create** → **Start with Hello World** → **Deploy**.
3. Нажми **Edit code**, удали всё, вставь содержимое `worker.js` и нажми **Deploy**.

### 3. Хранилище
1. Слева выбери **Storage & Databases** → **KV** → **Create** и назови `elytra-support`.
2. Вернись в свой Worker → **Settings** → **Bindings** → **Add** → **KV namespace**.
   Variable name: `SUPPORT`, namespace: `elytra-support` → **Deploy**.

### 4. Секреты
Worker → **Settings** → **Variables and Secrets** → **Add**, тип **Secret**:
- `BOT_TOKEN` — токен от BotFather;
- `SECRET` — любой пароль из латинских букв и цифр, например `elytra_k8f2mq`.

### 5. Подключи
Открой в браузере `https://ИМЯ-ВОРКЕРА.workers.dev/setup?key=ТВОЙ_SECRET`,
нажми «Стать хозяином бота» и в Telegram нажми **Start**.

После этого скинь адрес `https://ИМЯ-ВОРКЕРА.workers.dev`. Его нужно вписать в `docs/support.json`,
и чат в Elytra включится у всех без обновления.
