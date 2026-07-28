import type { TButtonSize, TButtonVariant } from '@/shared/ui';
import { Button, Dialog, Icon, Panel, Select } from '@/shared/ui';

const VARIANTS: TButtonVariant[] = ['primary', 'accent', 'ghost', 'danger'];
const SIZES: TButtonSize[] = ['sm', 'md', 'icon'];

/** Один набор опций на все срезы Select ниже — чтобы правки не расходились по копиям.
 *  Инлайним `DIFFICULTY_OPTIONS.map(...)` прямо в каждый `<Select>`: `Select` парсит
 *  `children` через `Children.forEach` и НЕ исполняет компоненты — обёртка-компонент
 *  вокруг `<option>` схлопнулась бы в одну пустую фантомную опцию (мишень визрегрессии
 *  показывала бы сломанные срезы). Массив `Children.forEach` разворачивает корректно. */
const DIFFICULTY_OPTIONS = [
    { value: 'easy', label: 'Лёгкая' },
    { value: 'normal', label: 'Обычная' },
    { value: 'hard', label: 'Тяжёлая' },
];

const difficultyOptions = DIFFICULTY_OPTIONS.map((o) => (
    <option key={o.value} value={o.value}>
        {o.label}
    </option>
));

function buttonLabel(variant: TButtonVariant, size: TButtonSize) {
    // Витрина — статичный превью-срез, иконка чисто декоративна (кнопка ничего не
    // делает): без aria-label, чтобы не озвучивать техническое имя варианта.
    if (size === 'icon') return <Icon name="play" />;
    return variant;
}

/** design-inventory.dc.html §03 «Компоненты»: базовые атомы (Button/Panel/Select)
 *  во всех вариантах/размерах + Dialog как оверлей общего назначения. */
export function BaseComponentsSection() {
    return (
        <div className="flex flex-col gap-8">
            <section className="flex flex-col gap-4">
                <h3 className="font-ui text-hud text-text uppercase">Button</h3>
                <div className="flex flex-col gap-4">
                    {VARIANTS.map((variant) => (
                        <div key={variant} className="flex flex-wrap items-center gap-3">
                            <span className="w-20 shrink-0 font-ui text-caption text-text-muted">
                                {variant}
                            </span>
                            {SIZES.map((size) => (
                                <Button key={size} variant={variant} size={size}>
                                    {buttonLabel(variant, size)}
                                </Button>
                            ))}
                            <Button variant={variant} size="md" disabled>
                                disabled
                            </Button>
                        </div>
                    ))}
                </div>
            </section>

            <section className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">Panel</h3>
                    <Panel>
                        <h4 className="mb-2 font-display text-h2 text-text">Приподнятая панель</h4>
                        <p className="text-body text-text-muted">
                            Фон под панелями держит спокойный тёмный тон — неон живёт только в
                            акцентах.
                        </p>
                    </Panel>
                </div>

                <div className="flex flex-col gap-3">
                    <h3 className="font-ui text-hud text-text uppercase">Select</h3>
                    <Panel className="grid grid-cols-2 place-items-center gap-4 py-8">
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">закрыт</span>
                            <Select id="ds-select-closed" label="Сложность">
                                {difficultyOptions}
                            </Select>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">выбран</span>
                            <Select id="ds-select-selected" label="Сложность" value="hard">
                                {difficultyOptions}
                            </Select>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">focus</span>
                            <Select
                                id="ds-select-focus"
                                label="Сложность"
                                className="shadow-[var(--ring-focus)]"
                            >
                                {difficultyOptions}
                            </Select>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                placeholder
                            </span>
                            <Select
                                id="ds-select-placeholder"
                                label="Сложность"
                                value=""
                                placeholder="Выберите…"
                            >
                                {difficultyOptions}
                            </Select>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">disabled</span>
                            <Select id="ds-select-disabled" label="Сложность" disabled>
                                <option value="easy">Лёгкая</option>
                            </Select>
                        </div>
                        <div className="col-span-2 flex flex-col items-center gap-2">
                            <span className="font-ui text-caption text-text-muted">
                                открыт (одна опция disabled)
                            </span>
                            <Select
                                id="ds-select-open"
                                label="Сложность"
                                value="normal"
                                defaultOpen
                            >
                                <option value="easy">Лёгкая</option>
                                <option value="normal">Обычная</option>
                                <option value="hard" disabled>
                                    Тяжёлая
                                </option>
                            </Select>
                        </div>
                    </Panel>
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h3 className="font-ui text-hud text-text uppercase">Dialog</h3>
                <Dialog open variant="static" aria-labelledby="ds-dialog-title">
                    <h4
                        id="ds-dialog-title"
                        className="mb-3 font-display text-h1 text-text uppercase"
                    >
                        Победа
                    </h4>
                    <p className="mb-6 text-body text-text-muted">
                        Прямое попадание. Враг повержен — можно взять реванш или вернуться в меню.
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost">Закрыть</Button>
                        <Button variant="primary">Реванш</Button>
                    </div>
                </Dialog>
            </section>
        </div>
    );
}
