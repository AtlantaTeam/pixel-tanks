import { SkyBackground, WindDustLayer } from '@/features/game-engine';

/**
 * Витрина ветровых пылинок приземного слоя (#550, §7 разбора #534): «дешёвый носитель»
 * ветра рядом с ареной. Четыре карточки — штиль, слабый, сильный и ночь.
 *
 * Кадр СТАТИЧЕН (`snapshotMs`), а не анимирован — ровно как у осадков: витрина служит
 * мишенью визуальной регрессии, и живой rAF давал бы разное поле частиц на каждом
 * прогоне. `reducedMotion={false}` здесь не «против доступности»: снапшот и так один
 * кадр без движения, а без этого флага сцена не рисует пылинки вовсе, и на витрине
 * оказались бы четыре пустых прямоугольника.
 *
 * Ночь показана отдельной карточкой: в ней слой рисует не пылинки, а подсветку кромки
 * песка — другая ветка `WindDust`, и без своей карточки её никто бы не сторожил.
 */
const CARDS = [
    { id: 'calm', name: 'Штиль', wind: 0, preset: 'day' as const },
    { id: 'light', name: 'Слабый ветер', wind: 0.004, preset: 'day' as const },
    // MAX_WIND = 0.01 — витрина обязана показывать достижимое в бою: 0.012 давало бы
    // «сильный ветер», которого в игре не бывает.
    { id: 'strong', name: 'Сильный ветер', wind: 0.01, preset: 'day' as const },
    { id: 'night', name: 'Ночь — кайма песка', wind: 0.01, preset: 'night' as const },
];

/** Время кадра: пылинки успевают разойтись от стартовой раскладки, но ещё не наматывают
 *  несколько оборотов — картинка читается как «ветер несёт», а не как шум. */
const SNAPSHOT_MS = 1200;

export function WindDustSection() {
    return (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {CARDS.map((card) => (
                <figure key={card.id} className="flex flex-col gap-2">
                    <div className="pixel-border relative aspect-video w-full overflow-hidden">
                        <SkyBackground
                            seed={`showcase-wind-${card.id}`}
                            preset={card.preset}
                            reducedMotion
                            className="absolute inset-0"
                        />
                        <WindDustLayer
                            seed={`showcase-wind-${card.id}`}
                            wind={card.wind}
                            preset={card.preset}
                            snapshotMs={SNAPSHOT_MS}
                            reducedMotion={false}
                            className="absolute inset-0"
                        />
                    </div>
                    <figcaption className="text-caption font-ui text-text-muted">
                        {card.name} ·{' '}
                        <code className="text-text-dim">wind {card.wind.toFixed(3)}</code>
                    </figcaption>
                </figure>
            ))}
        </div>
    );
}
