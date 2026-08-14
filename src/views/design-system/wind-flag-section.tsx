import { MAX_WIND, SkyBackground, WindFlagDemo } from '@/features/game-engine';

/**
 * Витрина флажка ветра (#579). Две оси, обе обязательны для этой правки:
 *
 * - **сила и направление** — штиль (вымпел виснет вдоль мачты), слабый ветер и
 *   максимум в обе стороны: наклон по-прежнему выводится из модели #550;
 * - **пресеты неба** — день / закат / ночь: янтарное полотнище с тёмной обводкой
 *   обязано читаться на светлом, оранжевом и тёмном фоне (критерий #579). Раньше
 *   флажок красился `accent` интерфейса и на ночном небе с песком вёл себя по-разному.
 *
 * Кадры статичны: витрина — мишень визуальной регрессии, живой rAF давал бы разный
 * снимок на каждом прогоне.
 */
const FORCE_CARDS = [
    { id: 'calm', name: 'Штиль', wind: 0 },
    { id: 'left', name: 'Ветер влево · максимум', wind: -MAX_WIND },
    { id: 'light-right', name: 'Слабый ветер вправо', wind: MAX_WIND / 3 },
    { id: 'right', name: 'Ветер вправо · максимум', wind: MAX_WIND },
];

const SKY_CARDS = [
    { id: 'day', name: 'День', preset: 'day' as const },
    { id: 'sunset', name: 'Закат', preset: 'sunset' as const },
    { id: 'night', name: 'Ночь', preset: 'night' as const },
];

function FlagCard({
    preset,
    wind,
    seed,
}: {
    preset: 'day' | 'sunset' | 'night';
    wind: number;
    seed: string;
}) {
    return (
        <div className="pixel-border relative aspect-[180/116] w-full overflow-hidden">
            <SkyBackground seed={seed} preset={preset} reducedMotion className="absolute inset-0" />
            <WindFlagDemo wind={wind} className="absolute inset-0" />
        </div>
    );
}

export function WindFlagSection() {
    return (
        <div className="flex flex-col gap-8">
            <div>
                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                    Сила и направление
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {FORCE_CARDS.map((card) => (
                        <figure key={card.id} className="flex flex-col gap-2">
                            <FlagCard
                                preset="day"
                                wind={card.wind}
                                seed={`showcase-flag-${card.id}`}
                            />
                            <figcaption className="text-caption font-ui text-text-muted">
                                {card.name} ·{' '}
                                <code className="text-text-dim">wind {card.wind.toFixed(4)}</code>
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                    Читаемость на пресетах неба
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {SKY_CARDS.map((card) => (
                        <figure key={card.id} className="flex flex-col gap-2">
                            <FlagCard
                                preset={card.preset}
                                wind={MAX_WIND * 0.7}
                                seed={`showcase-flag-sky-${card.id}`}
                            />
                            <figcaption className="text-caption font-ui text-text-muted">
                                {card.name}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>
        </div>
    );
}
