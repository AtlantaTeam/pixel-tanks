'use client';

import { useGameStore } from '@/features/game-engine';
import { BOT_NAME } from '@/shared/config';
import { useMuteState } from '@/shared/lib/audio';
import { useAnimatedValue } from '@/shared/lib/animation';
import { Button, Select } from '@/shared/ui';
import { KeyboardSchemeHint } from './keyboard-scheme-hint';

const formatAngle = (radians: number) => {
    const normalized = radians < 0 ? -radians : 2 * Math.PI - radians;

    return ((normalized * 180) / Math.PI) | 0;
};

export function GameControls() {
    const power = useGameStore((s) => s.power);
    const angle = useGameStore((s) => s.angle);
    const moves = useGameStore((s) => s.moves);
    const playerPoints = useGameStore((s) => s.playerPoints);
    const enemyPoints = useGameStore((s) => s.enemyPoints);
    const weapons = useGameStore((s) => s.weapons);
    const selectedWeapon = useGameStore((s) => s.selectedWeapon);

    const increaseAngle = useGameStore((s) => s.increaseAngle);
    const increasePower = useGameStore((s) => s.increasePower);
    const selectWeapon = useGameStore((s) => s.selectWeapon);

    const { isMuted, toggle: toggleMute } = useMuteState();

    // Счёт и ходы обновляются в сторе скачком (попадание, ход) — HUD плавно
    // дотягивает отображаемое число к нему, а не дёргается мгновенно.
    const displayedPlayerPoints = Math.round(useAnimatedValue(playerPoints));
    const displayedEnemyPoints = Math.round(useAnimatedValue(enemyPoints));
    const displayedMoves = Math.round(useAnimatedValue(moves));

    return (
        <div className="flex flex-col gap-2 p-2 sm:gap-4 sm:p-4">
            <div className="flex items-center justify-end">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
                    title={isMuted ? 'Включить звук' : 'Выключить звук'}
                >
                    {isMuted ? '🔇' : '🔊'}
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
                <div className="flex flex-col items-center gap-2">
                    <div className="font-pixel text-xs text-muted">Игрок</div>
                    <div className="font-pixel text-2xl text-primary">{displayedPlayerPoints}</div>
                </div>

                <div className="flex flex-wrap items-end justify-center gap-2 sm:gap-4">
                    <Counter
                        label="Мощность"
                        value={power}
                        onDec={() => increasePower(-1)}
                        onInc={() => increasePower(1)}
                    />
                    <Counter
                        label="Угол"
                        value={formatAngle(angle)}
                        onDec={() => increaseAngle(Math.PI / 180)}
                        onInc={() => increaseAngle(-Math.PI / 180)}
                    />
                    <Select
                        id="weapon-select"
                        label="Оружие"
                        className="w-36"
                        value={selectedWeapon?.id ?? ''}
                        onChange={(e) => {
                            const next = weapons.find((w) => w.id === Number(e.target.value));
                            if (next) selectWeapon(next);
                        }}
                    >
                        {weapons.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name} #{w.id}
                            </option>
                        ))}
                    </Select>
                    <Counter label="Ходы" value={displayedMoves} />
                </div>

                <div className="flex flex-col items-center gap-2">
                    <div className="font-pixel text-xs text-muted">{BOT_NAME}</div>
                    <div className="font-pixel text-2xl text-danger">{displayedEnemyPoints}</div>
                </div>
            </div>

            <div className="border-t border-base-300 pt-2 sm:pt-4">
                <KeyboardSchemeHint />
            </div>
        </div>
    );
}

type TCounterProps = {
    label: string;
    value: number | string;
    onDec?: () => void;
    onInc?: () => void;
};

function Counter({ label, value, onDec, onInc }: TCounterProps) {
    return (
        <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-muted">{label}</span>
            <div className="flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDec}
                    disabled={!onDec}
                    aria-label={`${label} меньше`}
                >
                    −
                </Button>
                <span className="min-w-[3rem] text-center font-pixel text-sm">{value}</span>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onInc}
                    disabled={!onInc}
                    aria-label={`${label} больше`}
                >
                    +
                </Button>
            </div>
        </div>
    );
}
