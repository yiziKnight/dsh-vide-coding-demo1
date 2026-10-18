/**
 * tests/damage.test.mjs
 * 伤害模拟（v0.2）的公式测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDb } from '../src/core/data.js';
import { computePanel } from '../src/core/stats.js';
import {
  computeDamage,
  skillScalingKey,
  skillMultipliers,
  DEFAULT_ENEMY,
} from '../src/core/damage.js';

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
  assert.ok(Math.abs(actual - expected) < eps, `期望 ${expected}，实际 ${actual}（差 ${actual - expected}）`);

/** 关闭小行迹的干净状态，保证面板可预测 */
function panelFor(characterId = '1003') {
  const char = db.charById.get(characterId);
  const state = {
    characterId,
    level: 80,
    lightConeId: '',
    lcLevel: 80,
    minorEnabled: Object.fromEntries(char.traces.map((t) => [t.id, false])),
    relics: {},
    buffs: {},
  };
  return computePanel(db, state);
}

test('技能倍率吃哪项属性：默认攻击力', () => {
  const himeko = db.charById.get('1003');
  const skill = himeko.skills.find((s) => s.type === 'BPSkill');
  assert.equal(skillScalingKey(skill), 'atk');
});

test('技能倍率吃哪项属性：能识别生命上限类技能', () => {
  const hpSkill = db.characters
    .flatMap((c) => c.skills)
    .find((s) => /生命值上限|生命上限/.test(s.desc ?? ''));
  assert.ok(hpSkill, '数据里应存在吃生命上限的技能');
  assert.equal(skillScalingKey(hpSkill), 'hp');
});

test('倍率表按等级取值', () => {
  const himeko = db.charById.get('1003');
  const skill = himeko.skills.find((s) => s.type === 'BPSkill');
  const lv1 = skillMultipliers(skill, 1);
  const lv10 = skillMultipliers(skill, 10);
  assert.ok(lv1.length > 0);
  assert.ok(lv10[0] > lv1[0], '高等级倍率应大于低等级');
  assert.deepEqual(lv1, skill.params[0]);
});

test('伤害：默认敌方参数下的完整乘区（姬子、100% 倍率）', () => {
  const panel = panelFor('1003');
  const skill = db.charById.get('1003').skills.find((s) => s.type === 'BPSkill');

  const dmg = computeDamage(panel, skill, { level: 80, multiplier: 1, enemy: DEFAULT_ENEMY });

  // 防御区 = (80+20) / [(80+20) + (80+20)] = 0.5
  close(dmg.defMul, 0.5);
  close(dmg.resMul, 0.8); // 1 - 20%
  close(dmg.toughnessMul, 0.9); // 未击破
  close(dmg.dmgMul, 1); // 无增伤
  close(dmg.base, panel.panel.atk);

  const expectedNonCrit = panel.panel.atk * 0.5 * 0.8 * 0.9;
  close(dmg.nonCrit, expectedNonCrit);
  close(dmg.crit, expectedNonCrit * 1.5); // CD 50%
  close(dmg.expected, expectedNonCrit * (1 + panel.panel.cr * panel.panel.cd));
});

test('伤害：防御区随减防 / 无视防御非线性降低', () => {
  const panel = panelFor('1003');
  const skill = db.charById.get('1003').skills.find((s) => s.type === 'BPSkill');

  const base = computeDamage(panel, skill, { level: 80, multiplier: 1, enemy: DEFAULT_ENEMY });
  const shred = computeDamage(panel, skill, {
    level: 80,
    multiplier: 1,
    enemy: { ...DEFAULT_ENEMY, defShred: 0.5 },
  });
  const ignore = computeDamage(panel, skill, {
    level: 80,
    multiplier: 1,
    enemy: { ...DEFAULT_ENEMY, defIgnore: 0.5 },
  });

  close(shred.defMul, 100 / 150);
  close(ignore.defMul, 100 / 150);
  assert.ok(shred.nonCrit > base.nonCrit, '减防应提升伤害');
  assert.ok(ignore.nonCrit > base.nonCrit, '无视防御应提升伤害');
});

test('伤害：抗性穿透、易伤、减伤、击破各自生效', () => {
  const panel = panelFor('1003');
  const skill = db.charById.get('1003').skills.find((s) => s.type === 'BPSkill');

  const pen = computeDamage(panel, skill, {
    level: 80,
    multiplier: 1,
    enemy: { ...DEFAULT_ENEMY, res: 0.4, resPen: 0.2 },
  });
  close(pen.resMul, 0.8);

  const vuln = computeDamage(panel, skill, {
    level: 80,
    multiplier: 1,
    enemy: { ...DEFAULT_ENEMY, vulnerability: 0.25 },
  });
  close(vuln.vulnMul, 1.25);

  const red = computeDamage(panel, skill, {
    level: 80,
    multiplier: 1,
    enemy: { ...DEFAULT_ENEMY, dmgReduction: 0.3 },
  });
  close(red.redMul, 0.7);

  const broken = computeDamage(panel, skill, {
    level: 80,
    multiplier: 1,
    enemy: { ...DEFAULT_ENEMY, broken: true },
  });
  close(broken.toughnessMul, 1);

  const base = computeDamage(panel, skill, { level: 80, multiplier: 1, enemy: DEFAULT_ENEMY });
  assert.ok(broken.nonCrit > base.nonCrit, '击破后伤害应更高');
});

test('伤害：倍率线性放大', () => {
  const panel = panelFor('1003');
  const skill = db.charById.get('1003').skills.find((s) => s.type === 'BPSkill');

  const one = computeDamage(panel, skill, { level: 80, multiplier: 1, enemy: DEFAULT_ENEMY });
  const two = computeDamage(panel, skill, { level: 80, multiplier: 2, enemy: DEFAULT_ENEMY });
  close(two.nonCrit, one.nonCrit * 2, 1e-6);
});

test('伤害：面板增伤计入对应元素乘区', () => {
  const panel = panelFor('1003');
  const skill = db.charById.get('1003').skills.find((s) => s.type === 'BPSkill');
  const char = db.charById.get('1003');

  // 开启小行迹（姬子带火伤 + 攻击加成）
  const withTraces = computePanel(db, {
    characterId: '1003',
    level: 80,
    minorEnabled: {},
    relics: {},
    buffs: {},
  });
  assert.equal(skillScalingKey(skill), 'atk');
  assert.equal(char.element, 'Fire');
  assert.ok(withTraces.dmgBonus.Fire > 1.2, '火伤加成应来自小行迹');

  const dmg = computeDamage(withTraces, skill, { level: 80, multiplier: 1, enemy: DEFAULT_ENEMY });
  close(dmg.dmgMul, withTraces.dmgBonus.Fire);
});
