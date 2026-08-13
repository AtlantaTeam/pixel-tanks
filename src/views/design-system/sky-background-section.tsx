import { SkyBackground, SKY_PRESETS } from '@/features/game-engine';

/**
 * Витрина слоистого неба боя (#479): три пресета времени суток день/закат/ночь,
 * каждый — с параллаксом облаков. Пресеты форсируются явно (в бою выбор идёт от
 * сида боя). Движение здесь ЗАМОРОЖЕНО (`reducedMotion`): витрина — мишень
 * визуальной регрессии, а непрерывно анимированные облака флейкали бы базлайн
 * по кадрам. Сид фиксирует стартовое положение облаков — снапшот детерминирован.
 */
export function SkyBackgroundSection() {
    return (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {SKY_PRESETS.map((preset) => (
                <figure key={preset.id} className="flex flex-col gap-2">
                    <div className="pixel-border relative aspect-video w-full overflow-hidden">
                        <SkyBackground
                            seed={`showcase-${preset.id}`}
                            preset={preset.id}
                            reducedMotion
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
