/**
 * tests/stats.test.mjs
 * 计算核心的 golden case 测试：数据全部来自 data/*.json（已提交的快照）。
 *
 * 运行：npm test  （或 node --test tests/stats.test.mjs）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDb } from '../src/core/data.js';
import { levelStats, computePanel, relicMainValue } from '../src/core/stats.js';
import { ascensionForLevel, RELIC_SLOTS } from '../src/core/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${name}.json`), 'utf8'));

const db = buildDb({
  version: read('version'),
  meta: read('meta'),
  properties: read('properties'),
  characters: read('characters'),
  lightcones: read('lightcones'),
  relics: read('relics'),
});

const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `期望 ${expected}，实际 ${actual}`);

/** 默认关闭全部小行迹，避免角色自带加成干扰断言 */
function baseState(overrides = {}) {
  const char = db.charById.get(overrides.characterId ?? '1003');
  return {
    characterId: '1003',
    level: 80,
    lightConeId: '',
    lcLevel: 80,
    minorEnabled: Object.fromEntries(char.traces.map((t) => [t.id, false])),
    relics: {},
    buffs: {},
    ...overrides,
  };
}

test('数据快照完整', () => {
  assert.equal(db.characters.length, 98);
  assert.equal(db.lightcones.length, 170);
  assert.equal(db.relics.sets.length, 62);
  assert.equal(db.cavernSets.length + db.planarSets.length, 62);
  assert.ok(db.planarSets.length > 0, '位面套装不应为空');
});

test('等级 → 晋阶映射', () => {
  assert.equal(ascensionForLevel(1), 0);
  assert.equal(ascensionForLevel(20), 0);
  assert.equal(ascensionForLevel(21), 1);
  assert.equal(ascensionForLevel(30), 1);
  assert.equal(ascensionForLevel(31), 2);
  assert.equal(ascensionForLevel(70), 5);
  assert.equal(ascensionForLevel(71), 6);
  assert.equal(ascensionForLevel(80), 6);
});

test('角色基础属性：姬子 lv80（权威值 1047 / 756 / 436 / 96）', () => {
  const himeko = db.charById.get('1003');
  const s = levelStats(himeko.stats, 80, 6);
  close(s.hp, 1047.816, 1e-3);
  close(s.atk, 756.756, 1e-3);
  close(s.def, 436.59, 1e-3);
  close(s.spd, 96);
  close(s.cr, 0.05);
  close(s.cd, 0.5);
});

test('角色基础属性：三月七 lv80 = 1058.4 / 511.56 / 573.3', () => {
  const march = db.charById.get('1001');
  const s = levelStats(march.stats, 80, 6);
  close(s.hp, 1058.4);
  close(s.atk, 511.56);
  close(s.def, 573.3);
  close(s.spd, 101);
});

test('光锥基础属性：三星「锋镝」lv80 = 846.72 / 317.52 / 264.6', () => {
  const lc = db.lcById.get('20000');
  const s = levelStats(lc.stats, 80, 6);
  close(s.hp, 846.72);
  close(s.atk, 317.52);
  close(s.def, 264.6);
});

test('遗器主词条：五星手部攻击 +15 = 352.8', () => {
  const slot = RELIC_SLOTS.find((s) => s.key === 'hand');
  const relic = { setId: '101', rarity: 5, level: 15, mainType: 'AttackDelta' };
  const v = relicMainValue(db, slot, relic);
  assert.equal(v.type, 'AttackDelta');
  close(v.value, 352.8, 1e-6);
});

test('遗器主词条：五星躯干攻击% +15 = 43.2%', () => {
  const slot = RELIC_SLOTS.find((s) => s.key === 'body');
  const relic = { setId: '101', rarity: 5, level: 15, mainType: 'AttackAddedRatio' };
  const v = relicMainValue(db, slot, relic);
  close(v.value, 0.432, 1e-9);
});

test('遗器主词条：位面球火属性增伤 +15 = 38.88%', () => {
  const slot = RELIC_SLOTS.find((s) => s.key === 'sphere');
  const relic = { setId: '301', rarity: 5, level: 15, mainType: 'FireAddedRatio' };
  const v = relicMainValue(db, slot, relic);
  assert.equal(v.type, 'FireAddedRatio');
  close(v.value, 0.3888, 1e-5);
});

test('位面套装：太空封印站 2 件套 +12% 攻击', () => {
  const state = baseState({
    relics: {
      sphere: { setId: '301', rarity: 5, level: 15, mainType: 'FireAddedRatio', subs: [] },
      rope: { setId: '301', rarity: 5, level: 15, mainType: 'SPRatioBase', subs: [] },
    },
  });
  const r = computePanel(db, state);
  close(r.panel.atk, r.base.atk * 1.12, 1e-9);
});

test('面板：角色 + 光锥 白字相加，无加成时面板等于白字', () => {
  const state = baseState({ lightConeId: '20000' });
  const r = computePanel(db, state);
  close(r.base.hp, 1047.816 + 846.72, 1e-3);
  close(r.base.atk, 756.756 + 317.52, 1e-3);
  close(r.panel.hp, r.base.hp, 1e-3);
  close(r.panel.atk, r.base.atk, 1e-3);
});

test('面板：躯干攻击% 主词条生效', () => {
  const state = baseState({
    lightConeId: '20000',
    relics: {
      body: { setId: '101', rarity: 5, level: 15, mainType: 'AttackAddedRatio', subs: [] },
    },
  });
  const r = computePanel(db, state);
  close(r.panel.atk, r.base.atk * 1.432, 1e-6);
});

test('面板：套装 2 件套 +12% 攻击（快枪手）', () => {
  const mk = () => ({ setId: '102', rarity: 5, level: 0, mainType: 'HPDelta', subs: [] });
  const state = baseState({ relics: { head: mk(), hand: mk() } });
  const r = computePanel(db, state);
  close(r.panel.atk, r.base.atk * 1.12, 1e-6);
});

test('面板：副词条的百分比与平值', () => {
  const state = baseState({
    relics: {
      head: {
        setId: '101',
        rarity: 5,
        level: 0,
        mainType: 'HPDelta',
        subs: [
          { type: 'CriticalChanceBase', value: 0.0648 },
          { type: 'SpeedDelta', value: 4 },
          { type: 'AttackAddedRatio', value: 0.0864 },
        ],
      },
    },
  });
  const r = computePanel(db, state);
  close(r.panel.cr, 0.05 + 0.0648);
  close(r.panel.spd, 96 + 4);
  close(r.panel.atk, r.base.atk * 1.0864, 1e-6);
});

test('面板：手动增益按百分比叠加', () => {
  const state = baseState({ buffs: { atkPct: 50, cd: 60, dmg: 30, spdFlat: 10 } });
  const r = computePanel(db, state);
  close(r.panel.atk, r.base.atk * 1.5);
  close(r.panel.cd, 1.1);
  close(r.dmgBonus.Fire, 1.3);
  close(r.panel.spd, 96 + 10);
});

test('面板：小行迹默认点亮，可关闭', () => {
  const himeko = db.charById.get('1003');
  const open = computePanel(db, { characterId: '1003', level: 80, relics: {}, buffs: {} });
  const closed = computePanel(db, baseState());
  assert.ok(open.panel.atk > closed.panel.atk, '开启小行迹后攻击应提高');
  assert.ok(open.panel.res > closed.panel.res, '开启小行迹后效果抵抗应提高');
  assert.ok(himeko.traces.length > 0);
});
