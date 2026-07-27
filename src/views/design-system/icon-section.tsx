import { ICON_NAMES, Icon } from '@/shared/ui';

/** design-inventory.dc.html §07 «Иконки»: сетка 16×16, currentColor — красятся
 *  любым токеном. Правило проекта: никаких эмодзи в роли иконок в продукте —
 *  только этот набор (энфорсится ESLint-правилом no-emoji-as-icon). */
export function IconSection() {
    return (
        <div className="flex flex-col gap-6">
            <p className="max-w-prose text-caption text-text-muted">
                SVG на сетке 16×16, штрих 2px, <code>currentColor</code> — красятся любым токеном.
                Ниже стандартный размер 24px.
            </p>
            <div className="max-w-prose border-[length:var(--border-w)] border-border border-l-[3px] border-l-accent bg-[color-mix(in_srgb,var(--color-accent-base)_6%,transparent)] p-3.5">
                <p className="text-caption leading-[1.55] text-text">
                    <b className="text-accent">Правило:</b> в продукте нет эмодзи и юникод-символов
                    в роли иконок — только SVG из этого набора (<code>currentColor</code>,
                    тема-aware через <code>--accent</code>). Это линтуемо (
                    <code>no-emoji-as-icon</code>).
                </p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                {ICON_NAMES.map((name) => (
                    <div
                        key={name}
                        className="flex flex-col items-center gap-2.5 border-[length:var(--border-w)] border-border bg-panel px-2 py-4 text-text"
                    >
                        <Icon name={name} className="text-accent" />
                        <span className="text-center font-ui text-[10px] text-text-muted">
                            {name}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
