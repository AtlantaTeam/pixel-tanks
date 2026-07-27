const SAMPLE_WORDS = ['Победа', 'Командир', 'Инвентарь', 'Целься'];

/** design-inventory.dc.html §13, решение D7: DotGothic16 вместо Pixelify Sans —
 *  латиница у Pixelify Sans ровная, но кириллица собрана неровно (О С Э Ю Ф
 *  скруглены, К Ж Я Д боксовее/тяжелее). DotGothic16 — dot-matrix с кириллицей
 *  в той же точечной сетке, что и латиница. «Было» — иллюстративный системный
 *  sans (файл Pixelify Sans после Фазы 1 не вендорится — сравнивать реальным
 *  шрифтом на витрине нечем, только описанием решения). */
export function DisplayFontSection() {
    return (
        <div className="flex flex-col gap-6">
            <div className="max-w-prose border-[length:var(--border-w)] border-border border-l-[3px] border-l-accent bg-[color-mix(in_srgb,var(--color-accent-base)_6%,transparent)] p-3.5">
                <p className="text-caption leading-[1.6] text-text">
                    <b className="text-accent">D7 · переголосован → DotGothic16.</b> Pixelify Sans
                    хорош латиницей, но кириллица собрана неровно — на русских заголовках буквы «из
                    разных шрифтов». После bake-off выбран DotGothic16 (OFL): единый вес и ритм
                    латиницы и кириллицы, аркадный характер. JetBrains Mono (UI/HUD) не тронут — его
                    кириллица ровная.
                </p>
            </div>
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-5.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-ui text-label tracking-[0.14em] text-danger uppercase">
                            Было · Pixelify Sans
                        </span>
                        <span className="font-ui text-[10px] text-text-dim">
                            неровная кириллица · шрифт не вендорится
                        </span>
                    </div>
                    <div className="flex flex-col gap-2.5 leading-none font-bold text-text-muted uppercase break-words">
                        {SAMPLE_WORDS.map((word) => (
                            <span key={word} className="font-sans text-[clamp(34px,7vw,46px)]">
                                {word}
                            </span>
                        ))}
                    </div>
                </div>
                <div
                    className="flex flex-col gap-4 border-[length:var(--border-w)] border-accent bg-panel p-5.5"
                    style={{ boxShadow: 'var(--glow)' }}
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-ui text-label tracking-[0.14em] text-accent uppercase">
                            Стало · DotGothic16
                        </span>
                        <span className="font-ui text-[10px] text-text-dim">
                            целостная кириллица
                        </span>
                    </div>
                    <div className="flex flex-col gap-2.5 leading-none font-bold text-text uppercase break-words">
                        {SAMPLE_WORDS.map((word) => (
                            <span key={word} className="font-display text-[clamp(34px,7vw,46px)]">
                                {word}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
