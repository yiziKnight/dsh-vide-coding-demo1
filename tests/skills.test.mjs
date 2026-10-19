/**
 * tests/skills.test.mjs
 * 技能分组测试：主行迹规范化、加强前/后模板、变体技能。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDb, MAIN_SKILL_TYPES } from '../src/core/data.js';
import { computePanel } from '../src/core/stats.js';

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

test('每个角色的主行迹恰好 4 条', () => {
  for (const char of db.characters) {
    assert.equal(char.mainSkills.length, 4, `${char.id} ${char.name} 主行迹数量异常`);
    const types = char.mainSkills.map((s) => s.type).sort();
    assert.deepEqual(types, [...MAIN_SKILL_TYPES].sort(), `${char.id} ${char.name} 主行迹类型不完整`);
  }
});

test('加强角色：瓦尔特拥有两套技能模板且倍率不同', () => {
  const walter = db.charById.get('1004');
  assert.equal(walter.hasEnhancement, true);
  assert.equal(walter.mainSkills.length, 4);
  assert.equal(walter.enhancedSkills.length, 4);

  const baseSkill = walter.mainSkills.find((s) => s.type === 'BPSkill');
  const enhancedSkill = walter.enhancedSkills.find((s) => s.type === 'BPSkill');
  assert.equal(baseSkill.id, '100402');
  assert.equal(enhancedSkill.id, '1100402');

  // 加强前后至少有一个技能的倍率不同（瓦尔特终结技差异最明显）
  const differs = walter.mainSkills.some(
    (base) => JSON.stringify(base.params) !== JSON.stringify(walter.enhancedSkills.find((e) => e.type === base.type)?.params),
  );
  assert.ok(differs, '加强前后至少一个技能倍率应不同');
  const baseUlt = walter.mainSkills.find((s) => s.type === 'Ultra');
  const enhancedUlt = walter.enhancedSkills.find((s) => s.type === 'Ultra');
  assert.notDeepEqual(baseUlt.params[0], enhancedUlt.params[0], '终结技加强前后倍率应不同');
});

test('加强角色共 10 名', () => {
  const enhanced = db.characters.filter((c) => c.hasEnhancement);
  assert.equal(enhanced.length, 10);
  const names = enhanced.map((c) => c.name);
  for (const expect of ['瓦尔特', '卡芙卡', '银狼', '希儿', '刃', '镜流', '藿藿', '花火', '黑天鹅', '流萤']) {
    assert.ok(names.includes(expect), `应包含 ${expect}`);
  }
});

test('变体技能：丹恒•饮月 有 4 个变体且不进主行迹', () => {
  const danheng = db.charById.get('1213');
  assert.equal(danheng.hasEnhancement, false);
  assert.equal(danheng.mainSkills.length, 4);
  const variantNames = danheng.variantSkills.map((s) => s.name);
  assert.ok(variantNames.includes('瞬华'));
  assert.ok(variantNames.includes('天矢阴'));
  assert.ok(variantNames.includes('盘拏耀跃'));
  for (const v of danheng.variantSkills) {
    assert.ok(
      danheng.mainSkills.some((m) => m.type === v.type),
      `变体 ${v.name} 应能对应到同类型主技能`,
    );
  }
});

test('普通角色没有加强模板与变体', () => {
  const himeko = db.charById.get('1003');
  assert.equal(himeko.hasEnhancement, false);
  assert.equal(himeko.enhancedSkills, null);
  assert.equal(himeko.variantSkills.length, 0);
  assert.equal(himeko.mainTraces.length, 10);
  assert.equal(himeko.enhancedTraces, null);
});

test('小行迹：每个角色 10 条，加强角色两套模板各 10 条', () => {
  for (const char of db.characters) {
    assert.equal(char.mainTraces.length, 10, `${char.id} ${char.name} 基础小行迹应为 10 条`);
  }
  const enhanced = db.characters.filter((c) => c.hasEnhancement);
  assert.equal(enhanced.length, 10);
  for (const char of enhanced) {
    assert.ok(char.enhancedTraces, `${char.name} 应有加强套小行迹`);
    assert.equal(char.enhancedTraces.length, 10, `${char.name} 加强套小行迹应为 10 条`);
    assert.equal(char.traces.length, 20, `${char.name} 原始数据里两套并存`);
  }
});

test('面板：切换加强模板时小行迹跟着切换（瓦尔特）', () => {
  const baseState = { characterId: '1004', level: 80, relics: {}, buffs: {}, skillMode: 'base' };
  const enhancedState = { ...baseState, skillMode: 'enhanced' };

  const base = computePanel(db, baseState);
  const enhanced = computePanel(db, enhancedState);

  // 瓦尔特基础套小行迹给攻击%，加强套改成效果命中%
  assert.ok(base.panel.atk > enhanced.panel.atk, '基础模板攻击力应更高');
  assert.ok(enhanced.panel.ehr > base.panel.ehr, '加强模板效果命中应更高');
  assert.equal(base.panel.ehr, 0);
});

test('记忆角色只算 4 条主行迹，忆灵技能不混入', () => {
  const aglaea = db.charById.get('1402');
  assert.equal(aglaea.mainSkills.length, 4);
  for (const skill of aglaea.mainSkills) {
    assert.ok(MAIN_SKILL_TYPES.includes(skill.type));
    assert.ok(!String(skill.type).startsWith('Memosprite'));
  }
});
