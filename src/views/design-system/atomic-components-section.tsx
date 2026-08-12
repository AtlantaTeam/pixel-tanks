'use client';

import { useState } from 'react';
import type { TSegmentedControlOption, TWeaponSelectorWeapon } from '@/shared/ui';
import {
    Avatar,
    Button,
    ChatBubble,
    DEMO_WEAPONS,
    FactionBadge,
    HPBar,
    Icon,
    PipRow,
    SegmentedControl,
    ShareButton,
    Toast,
    Toggle,
    TextInput,
    WeaponSelector,
} from '@/shared/ui';
import { noop, PERIOD_OPTIONS } from './screens/_demo';

// Тексты подсказок зеркалят STATUS_HINT из share-button.tsx (внутреннее состояние
// компонента недоступно снаружи) — статичные репро состояний для витрины/визрегрессии.
const SHARE_HINT_COPIED = 'Ссылка скопирована в буфер обмена';
const SHARE_HINT_UNAVAILABLE = 'Не удалось поделиться — скопируйте ссылку из адресной строки';

const DIFFICULTY_OPTIONS: TSegmentedControlOption<'rookie' | 'shooter' | 'terminator'>[] = [
    { value: 'rookie', label: 'Новобранец' },
    { value: 'shooter', label: 'Стрелок' },
    { value: 'terminator', label: 'Терминатор' },
];

const WEAPONS = DEMO_WEAPONS;

// Статичный срез «боезапас исчерпан» (ammo=0) для витрины/визрегрессии: сигнал
// ×0 danger живёт в WeaponSelector как состояние компонента (см. его докблок).
const EMPTY_WEAPON_SLOT: TWeaponSelectorWeapon[] = [{ name: 'Фугас', icon: 'wpn-фугас', ammo: 0 }];

/** design-inventory.dc.html §08 «Новые компоненты»: инвентарь атомов данных и
 *  контролов из shared/ui со всеми состояниями в одной сетке карточек. */
export function AtomicComponentsSection() {
    const [period, setPeriod] = useState<'day' | 'all'>('day');
    const [difficulty, setDifficulty] = useState<'rookie' | 'shooter' | 'terminator'>('shooter');
    const [vibrationOn, setVibrationOn] = useState(true);
    const [autoAimOn, setAutoAimOn] = useState(false);
    const [weaponIndex, setWeaponIndex] = useState(0);

    return (
        <div className="grid grid-cols-1 gap-0.5 lg:grid-cols-2">
            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Text Input
                </span>
                <div className="grid gap-4">
                    <TextInput
                        id="ds-atomic-textinput-email"
                        label="Email"
                        placeholder="commander@tanks.io"
                    />
                    <TextInput
                        id="ds-atomic-textinput-password"
                        label="Пароль"
                        type="password"
                        defaultValue="tankLord42"
                    />
                    <TextInput
                        id="ds-atomic-textinput-error"
                        label="Email"
                        defaultValue="commander@"
                        error="Неверный формат email"
                    />
                    <TextInput
                        id="ds-atomic-textinput-disabled"
                        label="Промокод (недоступно)"
                        defaultValue="—"
                        disabled
                    />
                </div>
            </div>

            <div className="flex flex-col gap-5 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Segmented Control
                </span>
                <div className="flex flex-col gap-3">
                    <span
                        id="ds-atomic-period-label"
                        className="font-ui text-label tracking-[0.14em] text-text-muted uppercase"
                    >
                        Период
                    </span>
                    <SegmentedControl
                        label="Период"
                        labelledBy="ds-atomic-period-label"
                        options={PERIOD_OPTIONS}
                        value={period}
                        onChange={setPeriod}
                        className="self-start"
                    />
                    <span
                        id="ds-atomic-difficulty-label"
                        className="font-ui text-label tracking-[0.14em] text-text-muted uppercase"
                    >
                        Сложность
                    </span>
                    <SegmentedControl
                        label="Сложность"
                        labelledBy="ds-atomic-difficulty-label"
                        options={DIFFICULTY_OPTIONS}
                        value={difficulty}
                        onChange={setDifficulty}
                        className="self-start"
                    />
                    <span
                        id="ds-atomic-difficulty-narrow-label"
                        className="font-ui text-label tracking-[0.14em] text-text-muted uppercase"
                    >
                        Перенос в узком контейнере
                    </span>
                    {/* Срез переноса: на контейнере уже суммы сегментов длинные подписи
                     *  переносятся на вторую строку (грациозная деградация вместо
                     *  горизонтального overflow) — важно для моб. паузы 390px. */}
                    <div className="w-52 max-w-full">
                        <SegmentedControl
                            label="Сложность (узко)"
                            labelledBy="ds-atomic-difficulty-narrow-label"
                            options={DIFFICULTY_OPTIONS}
                            value={difficulty}
                            onChange={setDifficulty}
                        />
                    </div>
                </div>

                <div className="h-0.5 bg-border" />

                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Avatar / бейдж фракции
                </span>
                <div className="flex items-center gap-4">
                    <Avatar faction="player">
                        <Icon name="star" />
                    </Avatar>
                    <Avatar faction="enemy">
                        <Icon name="skull" />
                    </Avatar>
                    <span className="font-ui text-label text-text-muted">
                        тема через
                        <br />
                        data-faction
                    </span>
                </div>

                <div className="h-0.5 bg-border" />

                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    FactionBadge
                </span>
                <div className="flex flex-wrap items-center gap-4">
                    <FactionBadge faction="player" />
                    <FactionBadge faction="enemy" />
                    <FactionBadge faction="unknown" />
                    <FactionBadge faction="player" size="sm" />
                    <FactionBadge faction="enemy" size="sm" />
                    <FactionBadge faction="unknown" size="sm" />
                </div>

                <div className="h-0.5 bg-border" />

                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Pip-ряд
                </span>
                <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2.5">
                        <span className="w-16 font-ui text-label text-text-muted">Снаряды</span>
                        <PipRow pips={[true, true, true, false, false]} label="снарядов" />
                    </div>
                    <div className="flex items-center gap-2.5">
                        <span className="w-16 font-ui text-label text-text-muted">Ходы</span>
                        <PipRow
                            pips={[true, true, false, false]}
                            color="var(--color-warning)"
                            label="ходов"
                        />
                    </div>
                    {/* Уменьшенный размер (size=10): грубая сила ветра до пристрелки
                        в ячейке ВЕТЕР верхнего HUD — тот же пип, компактнее. */}
                    <div className="flex items-center gap-2.5">
                        <span className="w-16 font-ui text-label text-text-muted">Ветер 10×10</span>
                        <PipRow
                            pips={[true, true, false]}
                            color="var(--color-warning)"
                            size={10}
                            label="грубая сила ветра"
                        />
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    HP-bar · порог цвета success→warning→danger
                </span>
                <div className="flex flex-col gap-3.5">
                    <HPBar label="100 — полный" value={100} faction="player" />
                    <HPBar label="72 — норма" value={72} faction="player" />
                    <HPBar label="38 — риск" value={38} faction="enemy" />
                    <HPBar label="12 — критично" value={12} faction="enemy" />
                    {/* Длинный ник — усечение многоточием на узкой карточке (handoff
                        «HP-карточка»): имя не переносится и не сдвигает счётчик HP. */}
                    <HPBar
                        label="Александр Неудержимый Командор Резервной Эскадрильи"
                        value={64}
                        faction="player"
                    />
                </div>
            </div>

            <div className="flex flex-col gap-5 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Weapon Selector
                </span>
                <WeaponSelector
                    weapons={WEAPONS}
                    selectedIndex={weaponIndex}
                    onPrev={() => setWeaponIndex((i) => (i - 1 + WEAPONS.length) % WEAPONS.length)}
                    onNext={() => setWeaponIndex((i) => (i + 1) % WEAPONS.length)}
                />

                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Weapon Selector · пусто (×0)
                </span>
                {/* Боезапас исчерпан (ammo=0): ×0 danger + приглушённый контур —
                    сигнал «стрелять нечем», не просто низкий заряд. */}
                <WeaponSelector
                    weapons={EMPTY_WEAPON_SLOT}
                    selectedIndex={0}
                    onPrev={noop}
                    onNext={noop}
                />

                <div className="h-0.5 bg-border" />

                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Chat-bubble бота (enemy)
                </span>
                <ChatBubble
                    faction="enemy"
                    speaker="Терминатор"
                    message="Твой угол смешон, человек. Считай ветер — или считай обломки."
                />
            </div>

            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Toggle · вкл / выкл
                </span>
                <div className="flex flex-col gap-4">
                    <Toggle label="Вибрация" checked={vibrationOn} onChange={setVibrationOn} />
                    <Toggle
                        label="Автоприцел"
                        sublabel="подсказка траектории"
                        checked={autoAimOn}
                        onChange={setAutoAimOn}
                    />
                    {/* Статичные срезы disabled — состояние без интеракции для визрегрессии. */}
                    <Toggle label="Звук боя (недоступно)" checked onChange={noop} disabled />
                    <Toggle label="Музыка (недоступно)" checked={false} onChange={noop} disabled />
                </div>
                <span className="font-ui text-label leading-[1.5] text-text-dim">
                    role=&quot;switch&quot;, тема через --accent, glow в состоянии «вкл»; ниже —
                    срезы disabled (вкл/выкл).
                </span>
            </div>

            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Toast / хинт (aria-live)
                </span>
                <div className="flex flex-col gap-2.5">
                    <Toast variant="success" message="Ссылка на реплей скопирована" />
                    <Toast variant="neutral" message="Синхронизация профиля…" />
                    <Toast variant="error" message="Не удалось поделиться" />
                </div>
            </div>

            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    ShareButton
                </span>
                <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
                    <div className="flex flex-col items-center gap-1">
                        <span className="font-ui text-caption text-text-muted">idle (живая)</span>
                        <ShareButton
                            label="Поделиться боем"
                            buildPayload={() => ({
                                title: 'Pixel Tanks',
                                text: 'Смотри мой бой в Pixel Tanks!',
                                url: typeof window === 'undefined' ? '' : window.location.href,
                            })}
                        />
                    </div>
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
                            <p className="text-[10px] text-text-muted">{SHARE_HINT_UNAVAILABLE}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
