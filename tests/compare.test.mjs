/**
 * tests/compare.test.mjs
 * v0.3 配装收益：词条收益排行 + 快照对比。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDb } from '../src/core/data.js';
import { computePanel } from '../src/core/stats.js';
import {
  snapshotState,
  singleRollValue,
  substatGains,
  compareWithSnapshot,
  SNAPSHOT_FIELDS,
} from '../src/core/compare.js';

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

function baseState(level = 80) {
  const char = db.charById.get('1003');
  return {
    characterId: '1003',
    level,
    lightConeId: '',
    lcLevel: 80,
    minorEnabled: Object.fromEntries(char.traces.map((t) => [t.id, false])),
    relics: {},
    buffs: {},
  };
}

const skill = () => db.charById.get('1003').skills.find((s) => s.type === 'BPSkill');
const damageOpts = (state) => ({
  skill: skill(),
  level: state.level,
  multiplier: 1,
  enemy: { level: 80, res: 0.2, resPen: 0, defShred: 0, defIgnore: 0, vulnerability: 0, dmgReduction: 0, broken: false },
});

test('快照：包含全部配装字段且为深拷贝', () => {
  const state = baseState();
  state.relics = { head: { setId: '101', rarity: 5, level: 15, mainType: 'HPDelta', subs: [] } };
  const snap = snapshotState(state);

  for (const field of SNAPSHOT_FIELDS) {
    assert.ok(field in snap, `快照应包含 ${field}`);
  }
  assert.equal(snap.characterId, undefined);

  state.relics.head.level = 0;
  assert.equal(snap.relics.head.level, 15, '快照应为深拷贝，不受后续修改影响');
});

test('词条数值：五星暴击率单次强化 = 3.24%', () => {
  const value = singleRollValue(db, 'CriticalChanceBase');
  assert.ok(Math.abs(value - 0.0324) < 1e-9, `实际 ${value}`);
});

test('词条收益：攻击% 是物理主 C 的第一优先', () => {
  const state = baseState();
  const panel = computePanel(db, state);
  const gains = substatGains(db, state, panel, damageOpts(state));

  assert.ok(gains.length >= 10);
  assert.equal(gains[0].type, 'AttackAddedRatio');
  assert.ok(gains[0].deltaPct > 0.03, '攻击% 单次词条应带来 >3% 提升');

  const hp = gains.find((g) => g.type === 'HPAddedRatio');
  assert.equal(hp.deltaPct, 0, '攻击倍率角色吃不到生命% 收益');
});

test('词条收益：暴击率达到 100% 后收益归零', () => {
  const state = baseState();
  state.buffs = { cr: 100 }; // +100% 暴击率，叠加基础 5% 后已溢出
  const panel = computePanel(db, state);
  assert.ok(panel.panel.cr >= 1);

  const gains = substatGains(db, state, panel, damageOpts(state));
  const cr = gains.find((g) => g.type === 'CriticalChanceBase');
  assert.equal(cr.deltaPct, 0, '暴击率溢出后单次词条无收益');
});

test('快照对比：当前 80 级 vs 快照 70 级，面板差值为正', () => {
  const state = baseState(80);
  state.snapshot = snapshotState(baseState(70));

  const panel = computePanel(db, state);
  const cmp = compareWithSnapshot(db, state, panel, damageOpts(state));

  assert.ok(cmp, '应返回对比结果');
  const hp = cmp.rows.find((r) => r.key === 'hp');
  assert.ok(hp.delta > 0, '80 级生命应高于 70 级');
  assert.ok(cmp.currentDamage.expected > cmp.snapshotDamage.expected, '80 级伤害应更高');
});

test('快照对比：无快照返回 null', () => {
  const state = baseState();
  const panel = computePanel(db, state);
  assert.equal(compareWithSnapshot(db, state, panel, damageOpts(state)), null);
});
