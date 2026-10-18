/**
 * src/core/compare.js
 * v0.3 配装收益：
 *  1. 副词条收益排行 —— 在当前面板下，每种副词条「1 个词条」能带来多少伤害提升
 *  2. 配装快照对比 —— 当前方案 vs 保存的快照
 */
import { computePanel } from './stats.js';
import { computeDamage } from './damage.js';

/** 参与快照的配装字段 */
export const SNAPSHOT_FIELDS = [
  'level',
  'lightConeId',
  'lcLevel',
  'superimpose',
  'relics',
  'buffs',
  'minorEnabled',
  'traceLevels',
  'skillMode',
  'enemy',
  'damageSkillId',
  'damageParamIndex',
  'damageMultiplier',
];

/** 深拷贝出可序列化的配装快照 */
export function snapshotState(state) {
  const snap = {};
  for (const field of SNAPSHOT_FIELDS) {
    snap[field] = JSON.parse(JSON.stringify(state[field] ?? null));
  }
  return snap;
}

/** 某个副词条「一次强化」的数值（五星副词条表的最大单 roll） */
export function singleRollValue(db, type) {
  const list = db.relics.subAffixes?.['5'] ?? [];
  const hit = list.find((a) => a.type === type);
  if (!hit) return 0;
  return hit.base + hit.step * (hit.stepNum ?? 1);
}

/**
 * 副词条收益排行：在现有面板上额外加 1 个词条，比较伤害变化。
 * @param {object} db
 * @param {object} state       当前配装状态
 * @param {object} panelResult computePanel() 结果
 * @param {object} damageOpts  { skill, level, multiplier, enemy }
 */
export function substatGains(db, state, panelResult, damageOpts) {
  const list = db.relics.subAffixes?.['5'] ?? [];
  const types = [...new Set(list.map((a) => a.type))];
  const baseDamage = computeDamage(panelResult, damageOpts.skill, damageOpts).expected;

  const rows = types.map((type) => {
    const value = singleRollValue(db, type);
    const nextState = {
      ...state,
      extraProperties: [...(state.extraProperties ?? []), { type, value }],
    };
    const nextPanel = computePanel(db, nextState);
    const nextDamage = computeDamage(nextPanel, damageOpts.skill, damageOpts).expected;
    return {
      type,
      name: db.properties[type]?.name ?? type,
      percent: !!db.properties[type]?.percent,
      value,
      damage: nextDamage,
      delta: nextDamage - baseDamage,
      deltaPct: baseDamage > 0 ? nextDamage / baseDamage - 1 : 0,
    };
  });

  return rows.sort((a, b) => b.deltaPct - a.deltaPct);
}

/** 参与对比的面板属性 */
export const COMPARE_ROWS = [
  { key: 'hp', label: '生命值', kind: 'flat' },
  { key: 'atk', label: '攻击力', kind: 'flat' },
  { key: 'def', label: '防御力', kind: 'flat' },
  { key: 'spd', label: '速度', kind: 'flat', digits: 1 },
  { key: 'cr', label: '暴击率', kind: 'percent' },
  { key: 'cd', label: '暴击伤害', kind: 'percent' },
  { key: 'ehr', label: '效果命中', kind: 'percent' },
  { key: 'res', label: '效果抵抗', kind: 'percent' },
  { key: 'be', label: '击破特攻', kind: 'percent' },
  { key: 'err', label: '能量恢复', kind: 'percent' },
  { key: 'heal', label: '治疗量', kind: 'percent' },
];

/**
 * 当前配装与快照的对比。
 * @returns {null|object}
 */
export function compareWithSnapshot(db, state, panelResult, damageOpts) {
  if (!state.snapshot) return null;

  const snapState = {
    ...state,
    ...JSON.parse(JSON.stringify(state.snapshot)),
    characterId: state.characterId,
    snapshot: null,
  };
  const snapPanel = computePanel(db, snapState);

  const rows = COMPARE_ROWS.map((row) => ({
    ...row,
    current: panelResult.panel[row.key],
    snapshot: snapPanel.panel[row.key],
    delta: panelResult.panel[row.key] - snapPanel.panel[row.key],
  }));

  let currentDamage = null;
  let snapshotDamage = null;
  if (damageOpts?.skill) {
    currentDamage = computeDamage(panelResult, damageOpts.skill, damageOpts);
    snapshotDamage = computeDamage(snapPanel, damageOpts.skill, damageOpts);
  }

  return {
    rows,
    currentDamage,
    snapshotDamage,
    snapshotPanel: snapPanel.panel,
  };
}
