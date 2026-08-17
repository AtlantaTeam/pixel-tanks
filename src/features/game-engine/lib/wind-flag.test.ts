import { describe, expect, it } from 'vitest';
import { MAX_WIND } from './wind';
import {
    WIND_FLAG_LENGTH,
    WIND_FLAG_PENNANT,
    WIND_FLAG_POLE_HEIGHT,
    WIND_FLAG_POLE_WIDTH,
    WIND_FLAG_THICKNESS,
    windFlagRotationRad,
    windFlagSide,
} from './wind-flag';

const NEUTRAL_RAD = Math.PI / 2;

describe('windFlagRotationRad — направление и сила (issue #550)', () => {
    it('wind = 0 → флажок в нейтрали (виснет вдоль мачты)', () => {
        expect(windFlagRotationRad(0)).toBeCloseTo(NEUTRAL_RAD);
    });

    it('положительный ветер (вправо) уводит угол ниже нейтрали (наклон к горизонтали)', () => {
        expect(windFlagRotationRad(MAX_WIND)).toBeLessThan(NEUTRAL_RAD);
    });

    it('отрицательный ветер (влево) уводит угол выше нейтрали', () => {
        expect(windFlagRotationRad(-MAX_WIND)).toBeGreaterThan(NEUTRAL_RAD);
    });

    it('знак наклона зеркален относительно знака ветра при равной силе', () => {
        const right = windFlagRotationRad(MAX_WIND * 0.5);
        const left = windFlagRotationRad(-MAX_WIND * 0.5);
        expect(NEUTRAL_RAD - right).toBeCloseTo(left - NEUTRAL_RAD);
    });

    it('три различимых положения на сторону (магнитуда 1..3)', () => {
        const angles = [1 / 3, 2 / 3, 1].map((ratio) => windFlagRotationRad(MAX_WIND * ratio));
        const distinct = new Set(angles.map((a) => Math.round(a * 1000)));
        expect(distinct.size).toBe(3);
    });

    it('монотонность: больший модуль ветра — сильнее наклон от нейтрали', () => {
        const weak = windFlagRotationRad(MAX_WIND * (1 / 3));
        const medium = windFlagRotationRad(MAX_WIND * (2 / 3));
        const strong = windFlagRotationRad(MAX_WIND);
        const leanOf = (rad: number) => Math.abs(NEUTRAL_RAD - rad);
        expect(leanOf(weak)).toBeLessThan(leanOf(medium));
        expect(leanOf(medium)).toBeLessThanOrEqual(leanOf(strong));
    });

    it('деление на ноль в windMagnitude (maxWind = 0) не роняет расчёт — остаётся нейтраль', () => {
        expect(windFlagRotationRad(MAX_WIND, 0)).toBeCloseTo(NEUTRAL_RAD);
    });
});

describe('WIND_FLAG_PENNANT — контур вымпела (issue #579)', () => {
    const maxX = () => Math.max(...WIND_FLAG_PENNANT.map((p) => p.x));

    it('это вымпел, а не прямоугольник: у контура больше четырёх вершин', () => {
        expect(WIND_FLAG_PENNANT.length).toBeGreaterThan(4);
    });

    /** Толщина полотнища в столбце `x` — разброс `y` его вершин. */
    const spreadAt = (x: number) => {
        const ys = WIND_FLAG_PENNANT.filter((p) => p.x === x).map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
    };

    it('полотнище сужается к свободному краю (у мачты толще, чем на конце)', () => {
        const fly = spreadAt(maxX());
        expect(fly).toBeLessThan(spreadAt(0));
        expect(fly).toBeGreaterThan(0);
    });

    it('вырез «ласточкин хвост»: вершина выреза вдавлена внутрь от свободного края', () => {
        const fly = maxX();
        const notch = WIND_FLAG_PENNANT.filter((p) => p.x !== 0 && p.x !== fly);
        expect(notch).toHaveLength(1);
        expect(notch[0].x).toBeLessThan(fly);
        expect(notch[0].x).toBeGreaterThan(0);
        // Вершина выреза — на средней линии полотнища: хвост раздваивается симметрично.
        expect(notch[0].y).toBeCloseTo(WIND_FLAG_THICKNESS / 2, 6);
    });

    it('габарит контура — канон WIND_FLAG_LENGTH × WIND_FLAG_THICKNESS', () => {
        expect(maxX()).toBe(WIND_FLAG_LENGTH);
        expect(spreadAt(0)).toBe(WIND_FLAG_THICKNESS);
    });

    it('полотнище висит по одну сторону от мачты — древко не режет его пополам', () => {
        const ys = WIND_FLAG_PENNANT.map((p) => p.y);
        expect(Math.min(...ys)).toBe(0);
        expect(Math.max(...ys)).toBe(WIND_FLAG_THICKNESS);
    });

    it('контур симметричен относительно средней линии полотнища (хвост без перекоса)', () => {
        const mid = WIND_FLAG_THICKNESS / 2;
        for (const point of WIND_FLAG_PENNANT) {
            const mirrored = WIND_FLAG_PENNANT.some(
                (other) => other.x === point.x && Math.abs(other.y - (2 * mid - point.y)) < 1e-9,
            );
            expect(mirrored).toBe(true);
        }
    });

    it('в покое полотнище виснет вдоль мачты, не доставая до силуэта башни', () => {
        // Нейтраль (wind = 0) — поворот на 90°: полотнище уходит вниз от вершины
        // мачты ровно на свою длину. Мачта выше — значит между концом вымпела и
        // верхом корпуса остаётся зазор, и флаг не лежит на башне (критерий #579).
        // Зазор ≥3, а не просто «больше нуля»: обводка полотнища (до 1 мировой
        // единицы шириной) идёт по центру контура и съедает половину просвета
        // (ревью #579 — на арене 1440 оставалось ≈2px).
        expect(WIND_FLAG_POLE_HEIGHT).toBeGreaterThanOrEqual(WIND_FLAG_LENGTH + 3);
    });

    it('древко не тоньше 2 px в каноне (различимо, а не волосок)', () => {
        expect(WIND_FLAG_POLE_WIDTH).toBeGreaterThanOrEqual(2);
    });
});

describe('windFlagSide — сторона провисания вымпела (ревью #579)', () => {
    it('ветер вправо и штиль — полотнище по +y (сторона 1)', () => {
        expect(windFlagSide(0)).toBe(1);
        expect(windFlagSide(0.004)).toBe(1);
        expect(windFlagSide(MAX_WIND)).toBe(1);
    });

    it('ветер влево — зеркально (сторона -1)', () => {
        expect(windFlagSide(-0.004)).toBe(-1);
        expect(windFlagSide(-MAX_WIND)).toBe(-1);
    });

    it('сторона выводится из знака ветра, а не из угла наклона', () => {
        // Пин связи формы с моделью: при любом ветре знак стороны совпадает со
        // знаком самого ветра, даже если наклон когда-нибудь перевалит за 90°
        // (сейчас максимум 60° — и на этом совпадение угла со знаком держалось).
        for (const wind of [-MAX_WIND, -MAX_WIND / 2, -1e-6, 0, 1e-6, MAX_WIND / 2, MAX_WIND]) {
            expect(windFlagSide(wind)).toBe(wind < 0 ? -1 : 1);
        }
    });
});
