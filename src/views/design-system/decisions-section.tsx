type TDecision = {
    tag: string;
    verdict: string;
    title: string;
    body: string;
};

// Верстка § 05 «Решения» design-inventory.dc.html — карточки скопированы
// дословно из инвентаря (paintAll().decisions), это протокол принятых решений,
// не наш текст.
const DECISIONS: TDecision[] = [
    {
        tag: 'D1',
        verdict: 'алиас',
        title: 'success = accent',
        body: '#48FF00 намеренно тот же неон. success — семантический алиас accent (успех = «свой» зелёный), НЕ отдельный оттенок. Токен --color-success оставлен как ссылка для читаемости кода.',
    },
    {
        tag: 'D2',
        verdict: 'введён',
        title: '--glow-danger именован',
        body: 'Раньше glow поражения инлайнился. Теперь это именованный токен в наборе glow-accent/primary/enemy/danger. Используется для defeat, ошибок и удаления.',
    },
    {
        tag: 'D3',
        verdict: 'правило',
        title: 'text-dim не на мелком',
        body: 'text-dim (3.6:1) не проходит AA на мелком. Правило: текст <18px — минимум text-muted (7.5:1). text-dim только ≥18px bold / чистый декор.',
    },
    {
        tag: 'D4',
        verdict: 'унифиц.',
        title: 'ink-пары показаны',
        body: 'primary-ink / accent-ink / enemy-ink / danger-ink — это текст поверх заливки. Показаны как контраст-подписи в бренд-палитре (§01); отдельными свотчами не выносим (они не фон).',
    },
    {
        tag: 'D5',
        verdict: 'удалён',
        title: 'только --radius-none',
        body: 'Система «острые углы». --radius-sm почти не используется — ни один компонент shared/ui не задаёт его напрямую. Остаётся единственный рабочий --radius-none: 0.',
    },
    {
        tag: 'D6',
        verdict: 'правило',
        title: 'accent: тема vs фикс',
        body: 'Фиксированный accent-base (всегда зелёный): номера секций, заголовки, «свой игрок». Тематический --accent (следует data-faction): все интерактивные компоненты, фокус, выбор, рамки активного.',
    },
];

export function DecisionsSection() {
    return (
        <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {DECISIONS.map((decision) => (
                <div
                    key={decision.tag}
                    className="flex flex-col gap-2 border-[length:var(--border-w)] border-border border-l-[3px] border-l-accent bg-panel p-4.5"
                >
                    <div className="flex items-center gap-2">
                        <span className="font-ui text-caption font-bold text-accent">
                            {decision.tag}
                        </span>
                        <span className="font-ui text-label tracking-[0.1em] text-warning uppercase">
                            {decision.verdict}
                        </span>
                    </div>
                    <div className="font-ui text-caption font-bold text-text">{decision.title}</div>
                    <div className="text-caption leading-[1.55] text-text-muted">
                        {decision.body}
                    </div>
                </div>
            ))}
        </div>
    );
}
