import { describe, expect, it } from 'vitest';
import { SECRET_FILE_CHANNELS, buildReport } from './secret-canary.mjs';
import {
    RESIDUAL_RISK_CHANNELS,
    evaluateGateVerdict,
    formatVerdict,
} from './secret-canary-gate.mjs';

// #190 (Изоляция ralph · Фаза 4): канарейка секретов становится ОБЯЗАТЕЛЬНЫМ красным
// чеком гейта. secret-canary.mjs (фаза 3, #184) остаётся ручным измерением с вечным
// exit 0 (докблок объясняет, почему); эта обёртка добавляет вердикт зелёный/красный на
// ТОЙ ЖЕ логике детекта, без живого скана в тестах (только чистые функции на фикстурах).

function fsError(code) {
    const e = new Error(`${code}: fake`);
    e.code = code;
    return e;
}

// Готовит report того же вида, что возвращает buildReport secret-canary.mjs, но целиком
// из фикстур (никаких настоящих env/файлов).
function report({ env = {}, files = {} } = {}) {
    const readFileFn = (path) => {
        if (path in files) return files[path];
        throw fsError('ENOENT');
    };
    return buildReport({ env, readFileFn, homedir: '/home/ralph' });
}

describe('RESIDUAL_RISK_CHANNELS — принятый остаточный риск (#192)', () => {
    it('ровно файловые каналы secret-canary.mjs — не шире и не уже', () => {
        expect([...RESIDUAL_RISK_CHANNELS].sort()).toEqual(
            SECRET_FILE_CHANNELS.map((c) => `file:${c.path}`).sort(),
        );
    });

    it('не содержит ни одного env:-канала', () => {
        for (const ch of RESIDUAL_RISK_CHANNELS) {
            expect(ch.startsWith('env:')).toBe(false);
        }
    });
});

describe('evaluateGateVerdict — зелёный/красный вердикт канарейки (#190)', () => {
    it('все каналы закрыты → ok', () => {
        const r = report();
        const v = evaluateGateVerdict(r);
        expect(v.ok).toBe(true);
        expect(v.leaked).toHaveLength(0);
    });

    it('открыт ТОЛЬКО принятый файловый канал остаточного риска (#192) → всё равно ok', () => {
        const knownFile = SECRET_FILE_CHANNELS[0];
        const r = report({
            files: { [`/home/ralph/${knownFile.path.replace(/^~\//, '')}`]: knownFile.markers[0] },
        });
        const v = evaluateGateVerdict(r);
        expect(v.ok).toBe(true);
        expect(v.accepted.some((c) => c.channel === `file:${knownFile.path}`)).toBe(true);
        expect(v.leaked).toHaveLength(0);
    });

    it('санация не закрыла env-секрет (allowlist ошибочно пропустил переменную) → красный', () => {
        const r = report({ env: { GH_TOKEN: 'ghp_live1234567890' } });
        const v = evaluateGateVerdict(r);
        expect(v.ok).toBe(false);
        expect(v.leaked).toHaveLength(1);
        expect(v.leaked[0].channel).toBe('env:GH_TOKEN');
    });

    it('открыт файловый канал ВНЕ списка принятого риска (новый, ещё не задокументированный) → красный', () => {
        const v = evaluateGateVerdict(report(), new Set()); // пустой accepted-список
        // report() без секретов даёт ok — проверяем именно сужение accepted на непустом report
        const knownFile = SECRET_FILE_CHANNELS[0];
        const r = report({
            files: { [`/home/ralph/${knownFile.path.replace(/^~\//, '')}`]: knownFile.markers[0] },
        });
        const v2 = evaluateGateVerdict(r, new Set()); // ничего не принято заранее
        expect(v.ok).toBe(true); // без открытых каналов пустой accepted не мешает
        expect(v2.ok).toBe(false);
        expect(v2.leaked[0].channel).toBe(`file:${knownFile.path}`);
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
        const knownFile = SECRET_FILE_CHANNELS[0];
        const r = report({
            files: { [`/home/ralph/${knownFile.path.replace(/^~\//, '')}`]: knownFile.markers[0] },
        });
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
