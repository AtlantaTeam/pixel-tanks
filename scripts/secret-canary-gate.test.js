import { describe, expect, it } from 'vitest';
import { SECRET_FILE_CHANNELS, buildReport, expandHome } from './secret-canary.mjs';
import { fsError } from './test-helpers.mjs';
import {
    RESIDUAL_RISK_CHANNELS,
    evaluateGateVerdict,
    formatVerdict,
} from './secret-canary-gate.mjs';

// #190 (Изоляция ralph · Фаза 4): канарейка секретов становится ОБЯЗАТЕЛЬНЫМ красным
// чеком гейта. secret-canary.mjs (фаза 3, #184) остаётся ручным измерением с вечным
// exit 0 (докблок объясняет, почему); эта обёртка добавляет вердикт зелёный/красный на
// ТОЙ ЖЕ логике детекта, без живого скана в тестах (только чистые функции на фикстурах).

// Готовит report того же вида, что возвращает buildReport secret-canary.mjs, но целиком
// из фикстур (никаких настоящих env/файлов). openFiles ключуются по ПУТИ канала (как в
// SECRET_FILE_CHANNELS), путь резолвится тем же expandHome, что и в проде.
function report({ env = {}, openFiles = {} } = {}) {
    const homedir = '/home/ralph';
    const byResolved = {};
    for (const [p, content] of Object.entries(openFiles)) {
        byResolved[expandHome(p, homedir)] = content;
    }
    const readFileFn = (resolved) => {
        if (resolved in byResolved) return byResolved[resolved];
        throw fsError('ENOENT');
    };
    return buildReport({ env, readFileFn, homedir });
}

// Каналы делим на «принят/не принят» через сам RESIDUAL_RISK_CHANNELS, чтобы тест не
// хардкодил конкретные пути и пережил их правку — важна лишь роль канала в вердикте.
const acceptedChannel = SECRET_FILE_CHANNELS.find((c) =>
    RESIDUAL_RISK_CHANNELS.has(`file:${c.path}`),
);
const unacceptedChannel = SECRET_FILE_CHANNELS.find(
    (c) => !RESIDUAL_RISK_CHANNELS.has(`file:${c.path}`),
);

describe('RESIDUAL_RISK_CHANNELS — принятый остаточный риск (#192)', () => {
    // #247: список — ОСОЗНАННЫЙ литерал ровно принятых каналов, а не автоследование за
    // детектором. Пинит выбор: приняли credentials.json и ralph.env, hosts.yml — нет.
    it('ровно два принятых канала #192 — credentials.json и ralph.env (осознанный литерал)', () => {
        expect([...RESIDUAL_RISK_CHANNELS].sort()).toEqual(
            ['file:/root/ralph.env', 'file:~/.claude/.credentials.json'].sort(),
        );
    });

    it('НЕ принимает ~/.config/gh/hosts.yml — его появление после gh auth login должно краснить гейт', () => {
        expect(RESIDUAL_RISK_CHANNELS.has('file:~/.config/gh/hosts.yml')).toBe(false);
    });

    it('не содержит ни одного env:-канала', () => {
        for (const ch of RESIDUAL_RISK_CHANNELS) {
            expect(ch.startsWith('env:')).toBe(false);
        }
    });
});

describe('evaluateGateVerdict — зелёный/красный вердикт канарейки (#190)', () => {
    it('все каналы закрыты → ok', () => {
        const v = evaluateGateVerdict(report());
        expect(v.ok).toBe(true);
        expect(v.leaked).toHaveLength(0);
    });

    it('открыт ТОЛЬКО принятый файловый канал остаточного риска (#192) → всё равно ok', () => {
        const r = report({ openFiles: { [acceptedChannel.path]: acceptedChannel.markers[0] } });
        const v = evaluateGateVerdict(r);
        expect(v.ok).toBe(true);
        expect(v.accepted.some((c) => c.channel === `file:${acceptedChannel.path}`)).toBe(true);
        expect(v.leaked).toHaveLength(0);
    });

    it('санация не закрыла env-секрет (allowlist ошибочно пропустил переменную) → красный', () => {
        const r = report({ env: { GH_TOKEN: 'ghp_live1234567890' } });
        const v = evaluateGateVerdict(r);
        expect(v.ok).toBe(false);
        expect(v.leaked).toHaveLength(1);
        expect(v.leaked[0].channel).toBe('env:GH_TOKEN');
    });

    // #247: непринятый файловый канал (hosts.yml после `gh auth login`) даёт красный в
    // ПРОДЕ — с ДЕФОЛТНЫМ accepted-списком, без инъекции пустого сета. Раньше этот сценарий
    // был достижим только в тесте (принимались все файловые каналы детектора).
    it('открыт файловый канал ВНЕ списка принятого риска (hosts.yml) → красный дефолтным вердиктом', () => {
        const r = report({ openFiles: { [unacceptedChannel.path]: unacceptedChannel.markers[0] } });
        const v = evaluateGateVerdict(r);
        expect(v.ok).toBe(false);
        expect(v.leaked.map((c) => c.channel)).toContain(`file:${unacceptedChannel.path}`);
    });

    it('пустой accepted при закрытых каналах не мешает — ok', () => {
        expect(evaluateGateVerdict(report(), new Set()).ok).toBe(true);
    });

    it('несколько открытых каналов сразу — все непринятые попадают в leaked', () => {
        const r = report({
            env: { GH_TOKEN: 'a', RALPH_TG_BOT_TOKEN: 'b' },
        });
        const v = evaluateGateVerdict(r);
        expect(v.leaked.map((c) => c.channel).sort()).toEqual([
            'env:GH_TOKEN',
            'env:RALPH_TG_BOT_TOKEN',
        ]);
    });
});

describe('formatVerdict — сообщение отличает «секрет найден» от иных причин (#190)', () => {
    it('красный вердикт: сообщение прямо называет находку секретом, не молчит списком каналов', () => {
        const r = report({ env: { GH_TOKEN: 'ghp_live1234567890' } });
        const v = evaluateGateVerdict(r);
        const text = formatVerdict(v);
        expect(text).toContain('СЕКРЕТ');
        expect(text).toContain('env:GH_TOKEN');
        // Не должен утверждать, что дело в allowlist — это другой класс отказа (см. ниже).
        expect(text).not.toMatch(/переменная.*не в allowlist.*привела/i);
    });

    it('красный вердикт явно отличает находку секрета от гипотезы «переменная не в allowlist»', () => {
        const r = report({ env: { GH_TOKEN: 'ghp_live1234567890' } });
        const text = formatVerdict(evaluateGateVerdict(r));
        expect(text.toLowerCase()).toContain('не в allowlist'.toLowerCase());
    });

    it('значение секрета не попадает в текст сообщения', () => {
        const secret = 'ghp_superSecretValue000111222';
        const r = report({ env: { GH_TOKEN: secret } });
        const text = formatVerdict(evaluateGateVerdict(r));
        expect(text).not.toContain(secret);
    });

    it('зелёный вердикт с принятым остаточным риском — сообщение зелёное, называет риск и ссылается на #192', () => {
        const r = report({ openFiles: { [acceptedChannel.path]: acceptedChannel.markers[0] } });
        const text = formatVerdict(evaluateGateVerdict(r));
        expect(text).toContain('✅');
        expect(text).toContain('#192');
    });

    it('зелёный вердикт без открытых каналов вообще — без упоминания остаточного риска', () => {
        const text = formatVerdict(evaluateGateVerdict(report()));
        expect(text).toContain('✅');
        expect(text).not.toContain('#192');
    });
});
