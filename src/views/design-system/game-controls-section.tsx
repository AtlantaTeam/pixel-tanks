'use client';

import { useState } from 'react';
import type { TSegmentedControlOption } from '@/shared/ui';
import { Button, Icon, PipRow, SegmentedControl } from '@/shared/ui';

const SPEED_OPTIONS: TSegmentedControlOption<'0.5' | '1' | '2'>[] = [
    { value: '0.5', label: '0.5×' },
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
];

const REPLAY_TOTAL_TURNS = 12;
const REPLAY_DEMO_TURN = 5;

/** design-inventory.dc.html §10 «Тач-рогатка · плеер реплея»: чистая UI-оболочка
 *  игровых контролов (без канвас-арены — арт арены/танков сменяем, судит его не
 *  визрегрессия витрины). Угол/сила/навигация — статичный демо-срез значений. */
export function GameControlsSection() {
    const [speed, setSpeed] = useState<'0.5' | '1' | '2'>('1');

    return (
        <div className="grid grid-cols-1 gap-0.5 lg:grid-cols-2">
            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Player-controls (тач)
                </span>

                <div className="flex items-center justify-between border-[length:var(--border-w)] border-border bg-surface px-3.5 py-2.5">
                    <span className="font-ui text-caption font-bold text-accent tabular-nums">
                        Угол 47°
                    </span>
                    <span className="font-ui text-caption font-bold text-warning tabular-nums">
                        Сила 064
                    </span>
                </div>

                <div className="flex items-stretch gap-2.5">
                    <Button variant="ghost" size="icon" aria-label="Влево">
                        <Icon name="arrow-l" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Вправо">
                        <Icon name="arrow-r" />
                    </Button>
                    <Button variant="primary" className="flex-1 gap-2 text-base">
                        <Icon name="fire" />
                        Огонь
                    </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Button variant="ghost" size="sm">
                        Угол +
                    </Button>
                    <Button variant="ghost" size="sm">
                        Угол −
                    </Button>
                    <Button variant="ghost" size="sm">
                        Сила +
                    </Button>
                    <Button variant="ghost" size="sm">
                        Сила −
                    </Button>
                </div>
            </div>

            <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Плеер реплея
                </span>
                <div className="flex items-center justify-between border-[length:var(--border-w)] border-border bg-surface px-3.5 py-2.5">
                    <span className="font-ui text-caption font-bold text-accent">
                        РЕПЛЕЙ · ход {REPLAY_DEMO_TURN}/{REPLAY_TOTAL_TURNS}
                    </span>
                </div>
                <PipRow
                    pips={Array.from(
                        { length: REPLAY_TOTAL_TURNS },
                        (_, i) => i < REPLAY_DEMO_TURN,
                    )}
                    label="ходов реплея"
                />
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" aria-label="Шаг назад">
                        <Icon name="arrow-l" />
                    </Button>
                    <Button variant="accent" size="icon" aria-label="Пауза/воспроизведение">
                        <Icon name="pause" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Шаг вперёд">
                        <Icon name="arrow-r" />
                    </Button>
                    <div className="flex-1" />
                    <SegmentedControl
                        label="Скорость воспроизведения"
                        options={SPEED_OPTIONS}
                        value={speed}
                        onChange={setSpeed}
                    />
                </div>
            </div>
        </div>
    );
}
