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
});

test('记忆角色只算 4 条主行迹，忆灵技能不混入', () => {
  const aglaea = db.charById.get('1402');
  assert.equal(aglaea.mainSkills.length, 4);
  for (const skill of aglaea.mainSkills) {
    assert.ok(MAIN_SKILL_TYPES.includes(skill.type));
    assert.ok(!String(skill.type).startsWith('Memosprite'));
  }
});
