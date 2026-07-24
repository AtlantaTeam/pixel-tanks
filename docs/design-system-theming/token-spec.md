# Pixel Tanks — Design Token Spec

Единый источник токенов для **Tailwind 4** (`@theme` + CSS-переменные). Выведено из hero-арта: неоновый пиксель-арт, высокий контраст, glow-обводки, тёмный зелёно-виньеточный фон, две фракции (зелёный игрок / фиолетовый враг).

**Якорь-цвета арта** (замерены с hero): neon-green `#48ff00`, mid-green `#217f00`, magenta `#c900ff`, action-orange `#ffa900`, muzzle-gold `#ffe000`, ground-brown `#301507`, bg near-black `#050805`.

**Решение по сатурации:** hero кричит неоном — но in-game UI должен читаться часами. Поэтому **поверхности держим спокойными** (тёмные зелёно-нейтральные), а неон/золото/маджента живут только в акцентах, glow-обводках и HUD-цифрах. Неон = событие, а не фон.

---

## 1. Семантические токены

### Нейтрали / поверхности (зелёно-тонированный тёмный)

| Токен                   | Hex       | Где применять                                             |
| ----------------------- | --------- | --------------------------------------------------------- |
| `--color-bg`            | `#080c08` | Фон вьюпорта / игрового шелла                             |
| `--color-surface`       | `#101711` | Фон под панелями, поля ввода, треки                       |
| `--color-panel`         | `#18221a` | Приподнятые панели, HUD-бар, диалоги, карточки лидерборда |
| `--color-panel-raised`  | `#212f24` | Вложенные блоки, hover-строки, активный сегмент           |
| `--color-border`        | `#2c3f30` | Хайрлайн-границы, разделители                             |
| `--color-border-strong` | `#3f5a41` | Границы фокусируемых контролов, рамки панелей             |
| `--color-muted`         | `#33452f` | Заглушки, disabled-фон, неактивные чипы                   |

### Текст

| Токен                | Hex       | Контраст на `--color-bg` | Где                                         |
| -------------------- | --------- | ------------------------ | ------------------------------------------- |
| `--color-text`       | `#e9f5e6` | ~15:1 ✅ AAA             | Основной текст, заголовки                   |
| `--color-text-muted` | `#a2bb9d` | ~7.5:1 ✅ AA             | Подписи, вторичный текст                    |
| `--color-text-dim`   | `#728a70` | ~3.6:1 ⚠️                | Только крупный/декоративный (≥18.66px bold) |

### Бренд / статус

| Токен             | Hex       | Ink (текст поверх)              | Где                                                                |
| ----------------- | --------- | ------------------------------- | ------------------------------------------------------------------ |
| `--color-primary` | `#ffc21f` | `--color-primary-ink` `#241900` | Главное действие: «Огонь», «Играть», подтверждение. Золото экшена. |
| `--color-accent`  | `#48ff00` | `--color-accent-ink` `#052400`  | Интерактив, фокус-ринг, выбранное, «свой» (игрок). Неон.           |
| `--color-enemy`   | `#c900ff` | `--color-enemy-ink` `#1e0030`   | Враг, вражеский ход/урон, магента-акцент.                          |
| `--color-danger`  | `#ff4242` | `--color-danger-ink` `#2b0000`  | Разрушительно / низкое HP / удаление.                              |
| `--color-warning` | `#ffa900` | `--color-warning-ink` `#2a1600` | Ветер, риск, попадание, «BOOM»-события.                            |
| `--color-success` | `#48ff00` | `--color-accent-ink`            | Победа, залечено, «hit» (= accent).                                |

> `primary` (золото) и `accent` (неон) намеренно разведены по роли: **золото = «нажми меня / действие», неон = «здесь ты / выбор / фокус»**. Не смешивать.

### Эффекты (glow / outline / пиксель-край)

| Токен            | Значение                                                    | Где                                            |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `--glow-accent`  | `0 0 6px rgba(72,255,0,.55), 0 0 18px rgba(72,255,0,.35)`   | Свечение неоновых обводок, выбранных элементов |
| `--glow-primary` | `0 0 6px rgba(255,194,31,.55), 0 0 18px rgba(255,169,0,.3)` | Свечение primary-кнопок, действия              |
| `--glow-enemy`   | `0 0 6px rgba(201,0,255,.55), 0 0 18px rgba(201,0,255,.35)` | Вражеский glow (тема enemy)                    |
| `--glow-text`    | `0 0 8px currentColor`                                      | Свечение HUD-цифр и лого-текста                |
| `--edge-pixel`   | `0 3px 0 #05140a`                                           | Жёсткая пиксель-тень «объёма» (лого, кнопки)   |
| `--ring-focus`   | `0 0 0 3px var(--color-bg), 0 0 0 5px var(--color-accent)`  | Клавиатурный фокус (двойной ринг)              |

### Радиусы / бордюры / тени (пиксельная эстетика — почти без скруглений)

| Токен              | Значение                                                      | Где                                            |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------- |
| `--radius-none`    | `0px`                                                         | Пиксельные панели, кнопки, поля (по умолчанию) |
| `--radius-sm`      | `2px`                                                         | Чипы, бейджи (лёгкое смягчение)                |
| `--border-w`       | `2px`                                                         | Толщина рамок контролов                        |
| `--border-w-thick` | `4px`                                                         | Рамки панелей/диалогов (пиксельная «фаска»)    |
| `--shadow-panel`   | `0 4px 0 rgba(0,0,0,.5), inset 0 0 0 2px var(--color-border)` | Приподнятые панели                             |
| `--shadow-drop`    | `0 6px 0 rgba(0,0,0,.55)`                                     | Диалоги / модалки                              |

---

## 2. Типографика

Две гарнитуры (обе с **полным кириллическим сабсетом**; в коде **self-hosted** из `public/fonts/`, не Google Fonts — офлайн-билд гейта #206, см. `tokens.md`):

- **`--font-display` → «DotGothic16»** — пиксельная битмап-гарнитура. Перекликается с блочным лого «PIXEL/TANKS», рисует заголовки, названия экранов, крупные счётчики. Кириллица ✅ (ровнее забракованного Pixelify Sans), единый вес.
- **`--font-ui` → «JetBrains Mono»** — моноширинный, читаемый в мелком кегле, **табличные цифры** для HUD (angle/power/wind/score не «прыгают»). Кириллица ✅. Роли: кнопки, метки, тело, HUD-числа.

Почему не «Press Start 2P» / «Silkscreen» — у них нет кириллицы; игра русскоязычная — это дисквалифицирует.

### Роли и scale

| Роль                  | Токен            | Шрифт / вес | Размер / межстрочный          | Прочее                            |
| --------------------- | ---------------- | ----------- | ----------------------------- | --------------------------------- |
| Display / лого-текст  | `--text-display` | Display 700 | `clamp(48px,7vw,96px)` / 0.95 | `letter-spacing:.02em`, glow-text |
| Заголовок экрана (H1) | `--text-h1`      | Display 700 | `40px` / 1.05                 | uppercase                         |
| Заголовок секции (H2) | `--text-h2`      | Display 600 | `28px` / 1.1                  |                                   |
| HUD-цифра (крупно)    | `--text-hud-xl`  | UI 700      | `40px` / 1                    | `tabular-nums`, glow-text         |
| HUD-цифра / метка     | `--text-hud`     | UI 700      | `20px` / 1.1                  | `tabular-nums`, uppercase-метки   |
| Кнопка                | `--text-button`  | UI 700      | `16px` / 1                    | `letter-spacing:.06em`, uppercase |
| Тело / body           | `--text-body`    | UI 400      | `16px` / 1.5                  |                                   |
| Мелкое / caption      | `--text-caption` | UI 400      | `13px` / 1.4                  | `--color-text-muted`              |
| Микро / метка поля    | `--text-label`   | UI 700      | `11px` / 1.3                  | uppercase, `letter-spacing:.12em` |

---

## 3. Темизация (CSS-переменные, без правки компонентов)

Tailwind 4: **палитра и шрифты живут в `@theme`** (генерят утилиты + переменные). **Переключаемые темы — это override CSS-переменных под селектором `[data-faction]`** вне `@theme` (Tailwind 4 не переключает `@theme` в рантайме — только через переопределение переменных).

Ось тем = **фракция**. Компоненты читают семантические `--accent` / `--glow-accent` / `--accent-ink`; фракция их подменяет. Никаких условных классов в разметке.

```css
/* нейтральный дефолт (меню, лидерборд) = игрок */
:root,
[data-faction='player'] {
    --accent: var(--color-accent); /* #48ff00 */
    --accent-ink: var(--color-accent-ink);
    --glow: var(--glow-accent);
}
/* активный ход врага / вражеский HUD / enemy game-over */
[data-faction='enemy'] {
    --accent: var(--color-enemy); /* #c900ff */
    --accent-ink: var(--color-enemy-ink);
    --glow: var(--glow-enemy);
}
/* победа / поражение можно накинуть поверх */
[data-outcome='defeat'] {
    --accent: var(--color-danger);
    --glow: 0 0 6px rgba(255, 66, 66, 0.6);
}
```

Опция (по желанию) — **режим «спокойный HUD»** для долгих сессий: `[data-intensity="calm"]` глушит glow до `0 0 0 transparent`, сохраняя цвета. Один атрибут — весь UI гасит неон.

---

## 4. `@theme` блок (готов в Tailwind 4)

```css
@import 'tailwindcss';

@theme {
    /* surfaces */
    --color-bg: #080c08;
    --color-surface: #101711;
    --color-panel: #18221a;
    --color-panel-raised: #212f24;
    --color-border: #2c3f30;
    --color-border-strong: #3f5a41;
    --color-muted: #33452f;
    /* text */
    --color-text: #e9f5e6;
    --color-text-muted: #a2bb9d;
    --color-text-dim: #728a70;
    /* brand / status */
    --color-primary: #ffc21f;
    --color-primary-ink: #241900;
    --color-accent: #48ff00;
    --color-accent-ink: #052400;
    --color-enemy: #c900ff;
    --color-enemy-ink: #1e0030;
    --color-danger: #ff4242;
    --color-danger-ink: #2b0000;
    --color-warning: #ffa900;
    --color-warning-ink: #2a1600;
    --color-success: #48ff00;
    /* type */
    --font-display: 'DotGothic16', system-ui, sans-serif;
    --font-ui: 'JetBrains Mono', ui-monospace, monospace;
    /* radius */
    --radius-none: 0px;
    --radius-sm: 2px;
}

/* эффекты + семантические theming-переменные — вне @theme, чтобы переключались в рантайме */
:root {
    --glow-accent: 0 0 6px rgba(72, 255, 0, 0.55), 0 0 18px rgba(72, 255, 0, 0.35);
    --glow-primary: 0 0 6px rgba(255, 194, 31, 0.55), 0 0 18px rgba(255, 169, 0, 0.3);
    --glow-enemy: 0 0 6px rgba(201, 0, 255, 0.55), 0 0 18px rgba(201, 0, 255, 0.35);
    --edge-pixel: 0 3px 0 #05140a;
    --accent: var(--color-accent);
    --accent-ink: var(--color-accent-ink);
    --glow: var(--glow-accent);
}
[data-faction='enemy'] {
    --accent: var(--color-enemy);
    --accent-ink: var(--color-enemy-ink);
    --glow: var(--glow-enemy);
}
```

---

## 5. Компоненты — токены по состояниям

**Button**

- `primary`: bg `--color-primary`, text `--color-primary-ink`, `box-shadow: var(--edge-pixel)`, hover `box-shadow: var(--edge-pixel), var(--glow-primary)`, active сдвиг `translateY(3px)` + тень 0.
- `accent` (фракционная): bg `--accent`, text `--accent-ink`, glow `var(--glow)`.
- `ghost`: прозрачный фон, рамка `--border-w` `--color-border-strong`, text `--color-text`, hover border `--accent`.
- `disabled`: bg `--color-muted`, text `--color-text-dim`, без glow.

**Panel** — bg `--color-panel`, border `--border-w-thick` `--color-border`, `box-shadow: var(--shadow-panel)`, заголовок `--text-h2` display. HUD-вариант: тот же фон, метки `--text-label` muted, цифры `--text-hud` с `--glow-text`.

**Select** — trigger как `ghost`-input: bg `--color-surface`, border `--color-border-strong`, text `--color-text`, стрелка `--color-text-muted`; фокус `--ring-focus`. Список: bg `--color-panel`, hover-строка `--color-panel-raised`, выбранная строка text `--accent` + галочка `--accent`.

**Dialog** — оверлей `rgba(4,8,4,.72)`; окно bg `--color-panel`, border `--border-w-thick` `--color-border-strong`, `box-shadow: var(--shadow-drop)`; заголовок `--text-h1`; действия в футере (primary + ghost). Game-over-диалог наследует `[data-outcome]` для смены акцента.

---

## 6. Экраны (применение)

- **Меню** — тёмный фон-виньетка, лого `--text-display` (белый верх + маджента-низ как в арте), кнопки primary/ghost стопкой, Select языка/сложности.
- **HUD** — верхний бар Panel: score (accent), угол/сила/ветер `--text-hud` табличные, чей ход задаёт `[data-faction]` (рамка активного игрока светится `--glow`). HP-бар: `--color-success`→`--color-warning`→`--color-danger`.
- **Лидерборд** — Panel со строками; 1-е место `--color-primary` + `--glow-primary`; свои строки — accent-подсветка слева (2px `--accent`).
- **Game-over** — Dialog поверх затемнённого поля; `[data-outcome="victory"]`→accent зелёный, `="defeat"`→danger; крупный `--text-h1`, статистика `--text-hud`, кнопки «Реванш» (primary) / «В меню» (ghost).
