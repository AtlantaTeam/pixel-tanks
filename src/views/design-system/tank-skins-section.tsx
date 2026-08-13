import { TANK_GEOMETRIES, TANK_PALETTES, TANK_SKINS, TankSkinPreview } from '@/entities/tank-skins';
import { TankWheelDemo } from '@/features/game-engine';

/**
 * Витрина скинов танков (issue #481): весь реестр — декартово произведение
 * геометрий (силуэтов) и палитр. Показывает и оси по отдельности (силуэт
 * читается сам по себе, палитра — сама по себе), и полный набор скинов, как
 * его видит пикер настроек (`features/tank-skin-select`).
 */
export function TankSkinsSection() {
    return (
        <div className="flex flex-col gap-8">
            <div>
                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                    Геометрии · {TANK_GEOMETRIES.length}
                </h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {TANK_GEOMETRIES.map((geometry) => (
                        <figure key={geometry.id} className="flex flex-col gap-2">
                            <div className="pixel-border bg-surface p-3">
                                <TankSkinPreview
                                    skin={{
                                        id: `${geometry.id}-verdant`,
                                        geometry,
                                        palette: TANK_PALETTES[0],
                                    }}
                                />
                            </div>
                            <figcaption className="text-caption font-ui text-text-muted">
                                {geometry.name} ·{' '}
                                <code className="text-text-dim">{geometry.id}</code>
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                    Палитры · {TANK_PALETTES.length}
                </h3>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                    {TANK_PALETTES.map((palette) => (
                        <div key={palette.id} className="flex flex-col gap-2">
                            <div
                                aria-hidden
                                className="h-12 w-full border-[length:var(--border-w)] border-border"
                                style={{ backgroundColor: palette.body }}
                            />
                            <span className="font-ui text-caption text-text">{palette.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                    Все скины · {TANK_SKINS.length}
                </h3>
                <p className="mb-3 max-w-prose text-caption text-text-muted">
                    Косметика: выбор не меняет HP, скорость или разброс — только вид (см.{' '}
                    <code className="text-text-dim">tank-skin-parity.test.ts</code>). Скин соперника
                    выбирается детерминированно от сида боя.
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
                    {TANK_SKINS.map((skin) => (
                        <figure key={skin.id} className="flex flex-col gap-2">
                            <div className="pixel-border bg-surface p-3">
                                <TankSkinPreview skin={skin} />
                            </div>
                            <figcaption className="text-center text-caption font-ui text-text-muted">
                                {skin.geometry.name}
                                <br />
                                {skin.palette.name}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                    Катки: движение · покой
                </h3>
                <p className="mb-3 max-w-prose text-caption text-text-muted">
                    Вращение катков (issue #496) — от пройденного пути, не от времени: на паузе
                    колёса не «доезжают» сами.{' '}
                    <code className="text-text-dim">prefers-reduced-motion</code> останавливает и
                    то, и другое.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {TANK_GEOMETRIES.map((geometry) => (
                        <div key={geometry.id} className="flex flex-col gap-3">
                            <span className="font-ui text-caption text-text-muted uppercase">
                                {geometry.name}
                            </span>
                            <div className="grid grid-cols-2 gap-3">
                                <figure className="flex flex-col gap-2">
                                    <div className="pixel-border bg-surface p-2">
                                        <TankWheelDemo skinId={`${geometry.id}-verdant`} moving />
                                    </div>
                                    <figcaption className="text-center text-caption font-ui text-text-muted">
                                        В движении
                                    </figcaption>
                                </figure>
                                <figure className="flex flex-col gap-2">
                                    <div className="pixel-border bg-surface p-2">
                                        <TankWheelDemo
                                            skinId={`${geometry.id}-verdant`}
                                            moving={false}
                                        />
                                    </div>
                                    <figcaption className="text-center text-caption font-ui text-text-muted">
                                        На месте
                                    </figcaption>
                                </figure>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
