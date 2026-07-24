'use client';

import { useState } from 'react';
import type { TFaction } from '@/shared/lib/theme';
import type { TButtonSize, TButtonVariant, TSegmentedControlOption } from '@/shared/ui';
import {
    Avatar,
    Button,
    Dialog,
    FactionBadge,
    HPBar,
    ICON_NAMES,
    Icon,
    Panel,
    SegmentedControl,
    Select,
    ShareButton,
    TextInput,
    Toggle,
} from '@/shared/ui';

const PERIOD_OPTIONS: TSegmentedControlOption<'day' | 'all'>[] = [
    { value: 'day', label: 'День' },
    { value: 'all', label: 'Всё время' },
];

const DIFFICULTY_OPTIONS: TSegmentedControlOption<'rookie' | 'shooter' | 'terminator'>[] = [
    { value: 'rookie', label: 'Новобранец' },
    { value: 'shooter', label: 'Стрелок' },
    { value: 'terminator', label: 'Терминатор' },
];

// Тексты подсказок зеркалят STATUS_HINT из share-button.tsx (внутреннее состояние
// компонента недоступно снаружи) — статичные репро состояний для витрины/визрегрессии.
const SHARE_HINT_COPIED = 'Ссылка скопирована в буфер обмена';
const SHARE_HINT_UNAVAILABLE = 'Не удалось поделиться — скопируйте ссылку из адресной строки';

const VARIANTS: TButtonVariant[] = ['primary', 'accent', 'ghost', 'danger'];
const SIZES: TButtonSize[] = ['sm', 'md', 'icon'];

function buttonLabel(variant: TButtonVariant, size: TButtonSize) {
    // Витрина — статичный превью-срез, иконка чисто декоративна (кнопка ничего не делает):
    // без aria-label, чтобы не озвучивать техническое имя варианта как содержимое.
    if (size === 'icon') return <Icon name="play" />;
    return variant;
}

export function DesignSystemPreview() {
    const [faction, setFaction] = useState<TFaction>('player');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [period, setPeriod] = useState<'day' | 'all'>('day');
    const [difficulty, setDifficulty] = useState<'rookie' | 'shooter' | 'terminator'>('shooter');
    const [vibrationOn, setVibrationOn] = useState(false);
    const [musicOn, setMusicOn] = useState(true);
    const [calmMode, setCalmMode] = useState(false);

    return (
        <div className="flex flex-col gap-6">
            {/* Свой data-faction на переключателе: активный тумблер (variant="accent")
                читает --accent этой обёртки и красится в цвет выбранной фракции —
                зелёный игрок / магента враг. Без обёртки он брал бы дефолтный
                :root --accent (всегда зелёный) и вводил в заблуждение. */}
            <div className="flex flex-wrap items-center gap-3" data-faction={faction}>
                <span className="font-ui text-label tracking-[0.12em] text-text-muted uppercase">
                    Фракция
                </span>
                <Button
                    variant={faction === 'player' ? 'accent' : 'ghost'}
                    size="sm"
                    onClick={() => setFaction('player')}
                    aria-pressed={faction === 'player'}
                >
                    Игрок
                </Button>
                <Button
                    variant={faction === 'enemy' ? 'accent' : 'ghost'}
                    size="sm"
                    onClick={() => setFaction('enemy')}
                    aria-pressed={faction === 'enemy'}
                >
                    Враг
                </Button>
                <span className="font-ui text-caption text-text-muted">
                    Меняет <code>data-faction</code> — accent-элементы переключаются без правки
                    разметки.
                </span>
            </div>

            <div
                data-testid="ds-faction-scope"
                data-faction={faction}
                className="flex flex-col gap-8 border-[length:var(--border-w)] border-border bg-surface p-4 sm:p-6"
            >
                <section className="flex flex-col gap-4">
                    <h3 className="font-ui text-hud text-text uppercase">Button</h3>
                    <div className="flex flex-col gap-4">
                        {VARIANTS.map((variant) => (
                            <div key={variant} className="flex flex-wrap items-center gap-3">
                                <span className="w-20 shrink-0 font-ui text-caption text-text-muted">
                                    {variant}
                                </span>
                                {SIZES.map((size) => (
                                    <Button key={size} variant={variant} size={size}>
                                        {buttonLabel(variant, size)}
                                    </Button>
                                ))}
                                <Button variant={variant} size="md" disabled>
                                    disabled
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="grid gap-6 md:grid-cols-2">
                    <div className="flex flex-col gap-3">
                        <h3 className="font-ui text-hud text-text uppercase">Panel</h3>
                        <Panel>
                            <h4 className="mb-2 font-display text-h2 text-text">
                                Приподнятая панель
                            </h4>
                            <p className="text-body text-text-muted">
                                Фон под панелями держит спокойный тёмный тон — неон живёт только в
                                акцентах.
                            </p>
                        </Panel>
                    </div>

                    <div className="flex flex-col gap-3">
                        <h3 className="font-ui text-hud text-text uppercase">Select</h3>
                        <Panel className="flex items-center justify-center">
                            <Select id="ds-difficulty" label="Сложность">
                                <option value="easy">Лёгкая</option>
                                <option value="normal">Обычная</option>
                                <option value="hard">Тяжёлая</option>
                            </Select>
                        </Panel>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <h3 className="font-ui text-hud text-text uppercase">TextInput</h3>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="flex flex-col gap-1">
                            <span className="font-ui text-caption text-text-muted">
                                обычное + плейсхолдер
                            </span>
                            <TextInput
                                id="ds-textinput-email"
                                label="Email"
                                placeholder="commander@tanks.io"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="font-ui text-caption text-text-muted">
                                пароль + eye-toggle
                            </span>
                            <TextInput
                                id="ds-textinput-password"
                                label="Пароль"
                                type="password"
                                defaultValue="tankLord42"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="font-ui text-caption text-text-muted">ошибка</span>
                            <TextInput
                                id="ds-textinput-error"
                                label="Email"
                                defaultValue="commander@"
                                error="Неверный формат email"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="font-ui text-caption text-text-muted">disabled</span>
                            <TextInput
                                id="ds-textinput-disabled"
                                label="Промокод (недоступно)"
                                defaultValue="—"
                                disabled
                            />
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <h3 className="font-ui text-hud text-text uppercase">SegmentedControl</h3>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                                Период
                            </span>
                            <SegmentedControl
                                label="Период"
                                options={PERIOD_OPTIONS}
                                value={period}
                                onChange={setPeriod}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                                Сложность
                            </span>
                            <SegmentedControl
                                label="Сложность"
                                options={DIFFICULTY_OPTIONS}
                                value={difficulty}
                                onChange={setDifficulty}
                            />
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <h3 className="font-ui text-hud text-text uppercase">Toggle</h3>
                    {/* «Спокойный HUD» реально прокинут в data-intensity этой обёртки:
                        включённый calmMode гасит неон-glow активных тумблеров (--glow → no-op),
                        чтобы витрина показывала настоящее поведение, а не только подпись. */}
                    <div
                        className="flex flex-col gap-4"
                        data-intensity={calmMode ? 'calm' : undefined}
                    >
                        <Toggle label="Вибрация" checked={vibrationOn} onChange={setVibrationOn} />
                        <Toggle
                            label="Музыка"
                            sublabel="фоновая тема"
                            checked={musicOn}
                            onChange={setMusicOn}
                        />
                        <Toggle
                            label="Спокойный HUD"
                            sublabel="гасит неон-glow · data-intensity=calm"
                            checked={calmMode}
                            onChange={setCalmMode}
                        />
                        <Toggle
                            label="Отключённый тумблер"
                            checked={false}
                            onChange={() => {}}
                            disabled
                        />
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">Dialog</h3>
                    <Button variant="primary" onClick={() => setDialogOpen(true)}>
                        Открыть диалог
                    </Button>
                    <Dialog
                        open={dialogOpen}
                        onClose={() => setDialogOpen(false)}
                        aria-labelledby="ds-dialog-title"
                    >
                        <h4
                            id="ds-dialog-title"
                            className="mb-3 font-display text-h1 text-text uppercase"
                        >
                            Победа
                        </h4>
                        <p className="mb-6 text-body text-text-muted">
                            Прямое попадание. Враг повержен — можно взять реванш или вернуться в
                            меню.
                        </p>
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                                Закрыть
                            </Button>
                            <Button variant="primary" onClick={() => setDialogOpen(false)}>
                                Реванш
                            </Button>
                        </div>
                    </Dialog>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">Avatar / FactionBadge</h3>
                    <p className="max-w-prose text-caption text-text-muted">
                        Бейджи фракции (player/enemy) с гло, или серый unknown без темы. Размеры: md
                        (56×56) и sm (44×44). Тема следует <code>data-faction</code> предка.
                    </p>
                    <div className="flex flex-wrap items-start gap-8">
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                Avatar: player (с Icon)
                            </span>
                            <Avatar faction="player">
                                <Icon name="star" />
                            </Avatar>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                Avatar: enemy (с Icon)
                            </span>
                            <Avatar faction="enemy">
                                <Icon name="skull" />
                            </Avatar>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                FactionBadge: player (md)
                            </span>
                            <FactionBadge faction="player" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                FactionBadge: enemy (md)
                            </span>
                            <FactionBadge faction="enemy" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                FactionBadge: unknown (md)
                            </span>
                            <FactionBadge faction="unknown" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                FactionBadge: player (sm)
                            </span>
                            <FactionBadge faction="player" size="sm" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                FactionBadge: enemy (sm)
                            </span>
                            <FactionBadge faction="enemy" size="sm" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                FactionBadge: unknown (sm)
                            </span>
                            <FactionBadge faction="unknown" size="sm" />
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">HPBar</h3>
                    <p className="max-w-prose text-caption text-text-muted">
                        Заливка по порогам HP: success (&gt;60) → warning (&gt;30) → danger. Иконка
                        «свой танк» / «враг» — фиксированный маркер, не следует теме
                        <code> data-faction</code>.
                    </p>
                    <div className="flex max-w-md flex-col gap-4">
                        <HPBar label="Игрок — полный" value={100} faction="player" />
                        <HPBar label="Игрок — норма" value={72} faction="player" />
                        <HPBar label="Враг — риск" value={38} faction="enemy" />
                        <HPBar label="Враг — критично" value={12} faction="enemy" />
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">Icon</h3>
                    <p className="max-w-prose text-caption text-text-muted">
                        Сетка 16×16, <code>currentColor</code> — иконка красится любым текстовым
                        токеном и следует теме/фракции без своего варианта. Полный набор из
                        design-inventory.dc.html, §07.
                    </p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                        {ICON_NAMES.map((name) => (
                            <div
                                key={name}
                                className="flex flex-col items-center gap-2 border-[length:var(--border-w)] border-border bg-panel p-3 text-text"
                            >
                                <Icon name={name} className="text-accent" />
                                <span className="text-center font-ui text-[10px] text-text-muted">
                                    {name}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">ShareButton</h3>
                    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
                        {/* Живая кнопка (idle): Web Share API на мобилках, иначе копирование в буфер */}
                        <div className="flex flex-col items-center gap-1">
                            <span className="font-ui text-caption text-text-muted">
                                idle (живая)
                            </span>
                            <ShareButton
                                label="Поделиться боем"
                                buildPayload={() => ({
                                    title: 'Pixel Tanks',
                                    text: 'Смотри мой бой в Pixel Tanks!',
                                    url: typeof window === 'undefined' ? '' : window.location.href,
                                })}
                            />
                        </div>

                        {/* Статичные репро состояний подсказки — состояние внутреннее, наружу не
                            управляется; показываем оба исхода для визрегрессии */}
                        <div className="flex flex-col items-center gap-1">
                            <span className="font-ui text-caption text-text-muted">
                                состояние: copied
                            </span>
                            <div className="mt-4 flex flex-col items-center gap-2">
                                <Button variant="ghost" size="md">
                                    Поделиться боем
                                </Button>
                                <p className="text-[10px] text-text-muted">{SHARE_HINT_COPIED}</p>
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-1">
                            <span className="font-ui text-caption text-text-muted">
                                состояние: unavailable
                            </span>
                            <div className="mt-4 flex flex-col items-center gap-2">
                                <Button variant="ghost" size="md">
                                    Поделиться боем
                                </Button>
                                <p className="text-[10px] text-text-muted">
                                    {SHARE_HINT_UNAVAILABLE}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
