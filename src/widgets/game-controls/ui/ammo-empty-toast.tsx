import { Toast } from '@/shared/ui';

/**
 * Тост «патроны кончились» (handoff «Патроны кончились»): держится над палубой
 * (`bottom-full` контейнера деки — автоматически над тем составом, который
 * сейчас показан по брейкпоинту, см. докблок `GameControls`), поэтому не
 * перекрывает телеметрию верхнего HUD. Манёвр при этом остаётся активным —
 * тост только предупреждает, что огонь недоступен, ход не блокирует.
 */
export function AmmoEmptyToast() {
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 flex justify-center px-2.5">
            <Toast
                variant="warning"
                message="Патроны кончились — остался только манёвр. Ход перейдёт сопернику."
                className="max-w-sm"
            />
        </div>
    );
}
