import { PRECIP_PRESETS, PrecipitationLayer, SkyBackground } from '@/features/game-engine';

/** Ветер витрины: одинаков для всех четырёх пресетов — снос частиц показывает НАКЛОН
 *  струи, а не силу ветра, и разные значения читались бы как разница между пресетами,
 *  которой нет. Величина — середина рабочего диапазона боя, при ней наклон различим
 *  на кадре 1400 мс и не вырождается ни в вертикаль, ни в горизонталь. */
const SHOWCASE_WIND = 0.006;

/**
 * Витрина осадков как погодного пресета (#546, §7.7): ясно / дождь / снег / буря.
 * Пресеты форсируются явно (в бою выбор идёт от сида). Частицы показаны СТАТИЧНЫМ
 * снапшотом на фиксированном времени сцены (`snapshotMs`), а не анимацией: витрина —
 * мишень визуальной регрессии, живой поток частиц флейкал бы базлайн по кадрам.
 * Снизу — небо дня для контекста, ветер задаёт снос частиц.
 */
export function PrecipitationSection() {
    return (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {PRECIP_PRESETS.map((preset) => (
                <figure key={preset.id} className="flex flex-col gap-2">
                    <div className="pixel-border relative aspect-video w-full overflow-hidden">
                        <SkyBackground
                            seed={`showcase-weather-${preset.id}`}
                            preset="day"
                            reducedMotion
                            className="absolute inset-0"
                        />
                        <PrecipitationLayer
                            seed={`showcase-weather-${preset.id}`}
                            preset={preset.id}
                            wind={SHOWCASE_WIND}
                            snapshotMs={1400}
                            className="absolute inset-0"
                        />
                    </div>
                    <figcaption className="text-caption font-ui text-text-muted">
                        {preset.name} · <code className="text-text-dim">{preset.id}</code>
                    </figcaption>
                </figure>
            ))}
        </div>
    );
}
