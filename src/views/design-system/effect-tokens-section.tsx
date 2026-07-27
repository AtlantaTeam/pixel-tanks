type TGlowSwatch = {
    name: string;
    hint: string;
    colorClassName: string;
};

const GLOW_SWATCHES: TGlowSwatch[] = [
    { name: '--glow-accent', hint: 'фокус · выбор · свой', colorClassName: 'bg-accent' },
    { name: '--glow-primary', hint: 'действие · золото', colorClassName: 'bg-primary' },
    { name: '--glow-enemy', hint: 'враг · маджента', colorClassName: 'bg-enemy' },
    { name: '--glow-danger', hint: 'поражение · удаление', colorClassName: 'bg-danger' },
];

const GLOW_VAR_BY_NAME: Record<string, string> = {
    '--glow-accent': 'var(--glow-accent)',
    '--glow-primary': 'var(--glow-primary)',
    '--glow-enemy': 'var(--glow-enemy)',
    '--glow-danger': 'var(--glow-danger)',
};

/** design-inventory.dc.html §06 «Glow · edge · focus · radius» — именованные
 *  эффект-токены с ролью использования, не голые свотчи. */
export function EffectTokensSection() {
    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                {GLOW_SWATCHES.map((glow) => (
                    <div
                        key={glow.name}
                        className="flex flex-col items-center gap-3.5 border-[length:var(--border-w)] border-border bg-panel p-5.5"
                    >
                        <div
                            aria-hidden
                            className={`size-14 ${glow.colorClassName}`}
                            style={{ boxShadow: GLOW_VAR_BY_NAME[glow.name] }}
                        />
                        <div className="flex flex-col items-center gap-0.5 text-center">
                            <span className="font-ui text-caption font-bold text-text">
                                {glow.name}
                            </span>
                            <span className="font-ui text-label text-text-muted">{glow.hint}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="flex flex-col items-start gap-3.5 border-[length:var(--border-w)] border-border bg-panel p-5.5">
                    <div
                        className="bg-primary px-4.5 py-3 font-ui text-caption font-bold text-primary-ink"
                        style={{ boxShadow: 'var(--edge-pixel)' }}
                    >
                        ПИКСЕЛЬ-ФАСКА
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <span className="font-ui text-caption font-bold text-text">
                            --edge-pixel
                        </span>
                        <span className="font-ui text-label text-text-muted">
                            0 3px 0 #05140a — «объём» без blur
                        </span>
                    </div>
                </div>

                <div className="flex flex-col items-start gap-3.5 border-[length:var(--border-w)] border-border bg-panel p-5.5">
                    <div
                        className="border-[length:var(--border-w)] border-border-strong bg-surface px-4.5 py-3 font-ui text-caption font-bold text-text"
                        style={{ boxShadow: 'var(--ring-focus)' }}
                    >
                        :focus-visible
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <span className="font-ui text-caption font-bold text-text">
                            --ring-focus
                        </span>
                        <span className="font-ui text-label text-text-muted">
                            двойной ринг, следует --accent
                        </span>
                    </div>
                </div>

                <div className="flex flex-col items-start gap-3.5 border-[length:var(--border-w)] border-border bg-panel p-5.5">
                    <div
                        aria-hidden
                        className="size-11 border-[length:var(--border-w)] border-border-strong bg-panel-raised"
                        style={{ borderRadius: 'var(--radius-none)' }}
                    />
                    <div className="flex flex-col gap-0.5">
                        <span className="font-ui text-caption font-bold text-text">
                            --radius-none (0px)
                        </span>
                        <span className="font-ui text-label leading-[1.5] text-text-muted">
                            Система «острые углы» (D5)
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
