'use client';

import { useState } from 'react';
import type { TFaction } from '@/shared/lib/theme';
import type { TButtonSize, TButtonVariant } from '@/shared/ui';
import { Button, Dialog, Panel, Select, ShareButton } from '@/shared/ui';

// Тексты подсказок зеркалят STATUS_HINT из share-button.tsx (внутреннее состояние
// компонента недоступно снаружи) — статичные репро состояний для витрины/визрегрессии.
const SHARE_HINT_COPIED = 'Ссылка скопирована в буфер обмена';
const SHARE_HINT_UNAVAILABLE = 'Не удалось поделиться — скопируйте ссылку из адресной строки';

const VARIANTS: TButtonVariant[] = ['primary', 'accent', 'ghost', 'danger'];
const SIZES: TButtonSize[] = ['sm', 'md', 'icon'];

function buttonLabel(variant: TButtonVariant, size: TButtonSize) {
    if (size === 'icon') return '▶';
    return variant;
}

export function DesignSystemPreview() {
    const [faction, setFaction] = useState<TFaction>('player');
    const [dialogOpen, setDialogOpen] = useState(false);

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
