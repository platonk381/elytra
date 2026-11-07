# Elytra

## Установка как обычное приложение

1. Распакуйте архив в любую папку.
2. Дважды кликните **install.bat**. Он сам поставит нужные библиотеки, соберёт `Elytra.exe`,
   установит его в `%LOCALAPPDATA%\Programs\Elytra` и создаст ярлыки на рабочем столе и в меню Пуск.
   Elytra появится в «Параметры → Приложения», удалять её можно оттуда.
3. Дальше запускайте Elytra с ярлыка. `run.bat` больше не нужен (он только для разработки).

Если Python не установлен, install.bat попробует поставить его сам через winget.

**Установщик для друзей.** Поставьте бесплатный Inno Setup 6 (https://jrsoftware.org/isdl.php)
и ещё раз запустите install.bat: появится `dist\Elytra-Setup.exe`. Его можно просто отправить
другу — Python ему не нужен. Windows SmartScreen может предупредить о «неизвестном издателе»:
«Подробнее → Выполнить в любом случае».

## Если не открывается Modrinth или сборки качаются долго

В некоторых сетях Modrinth, Fabric и серверы Mojang заблокированы или сильно замедлены.
Elytra проверяет это при запуске и сама берёт файлы через зеркала (BMCLAPI и MCIM).
Состояние видно в **Настройки → Источники загрузки**. Если что-то не так, нажмите
«Только зеркала». Все ошибки пишутся в лог: кнопка «Открыть лог» там же
(файл `%APPDATA%\.elytra\elytra.log`).

---

# Настройка Elytra (необязательно)

Три функции требуют вашего собственного ID. Без них лаунчер работает, просто эти функции выключены.
Все ID вписываются в самом верху файла `launcher.py`, в блоке `SETUP`. После этого заново запустите `build.bat`.

---

## 1. Статус в Discord (`DISCORD_CLIENT_ID`)

1. Откройте https://discord.com/developers/applications и войдите.
2. **New Application** → назовите **Elytra** (это имя друзья увидят: «Играет в Elytra»).
3. На странице приложения скопируйте **Application ID**.
4. Вставьте его: `DISCORD_CLIENT_ID = "123456789012345678"`.
5. (Необязательно) **Rich Presence → Art Assets** → загрузите логотип с именем `elytra` — он появится в статусе.

В лаунчере: Настройки → «Статус в Discord».

---

## 2. Вход через Microsoft (`MS_CLIENT_ID`)

1. https://portal.azure.com → **App registrations** → **New registration**.
   - Name: `Elytra`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: платформа **Public client/native (mobile & desktop)**,
     адрес `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. В разделе **Authentication** включите **Allow public client flows → Yes** и сохраните.
3. На странице **Overview** скопируйте **Application (client) ID** и **Directory (tenant) ID**.
4. Впишите `MS_CLIENT_ID = "ваш-id"`, соберите лаунчер и **один раз попробуйте войти** —
   будет ошибка, это нормально: Mojang хочет видеть активность приложения перед одобрением.
5. Отправьте оба ID в форму Mojang: https://aka.ms/mce-reviewappid
   Ждать одобрения — от нескольких дней до пары недель, потом до суток, пока доступ заработает.

`LICENSE_ONLY = True` — играть можно только с лицензией (вход по нику пропадёт).
Поставьте `False`, если хотите оставить и вход по нику.

Токены входа хранятся зашифрованными ключом вашей учётной записи Windows.

---

## 3. Автообновление лаунчера (`UPDATE_REPO`)

1. Создайте репозиторий на GitHub, например `vasya/elytra`.
2. Впишите: `UPDATE_REPO = "vasya/elytra"`.
3. Чтобы выпустить обновление:
   - поднимите `VERSION` в `launcher.py` (например `"0.4.1"`);
   - соберите `build.bat`;
   - на GitHub: **Releases → Draft a new release**, тег `v0.4.1`, прикрепите `dist\Elytra.exe`, опубликуйте.
4. У всех, у кого стоит Elytra, при запуске появится «Вышла Elytra 0.4.1 — Обновить».
