/**
 * src/core/stats.js
 * 面板合成计算 —— 纯函数，不依赖 DOM，便于单元测试。
 *
 * 公式（已用游戏权威数值交叉验证）：
 *   stat(L, p) = values[p].base + values[p].step × (L − 1)
 *   p 为晋阶阶段（0–6），由等级推导，见 constants.js#ascensionForLevel
 *
 *   生命 = (角色生命 + 光锥生命) × (1 + Σ生命%) + Σ生命固定
 *   攻击 / 防御 同理；速度 = 角色速度 × (1 + Σ速度%) + Σ速度固定
 */
import { ascensionForLevel, PROPERTY_MAP, RELIC_SLOTS, ELEMENT_DMG_KEYS } from './constants.js';

/** 读取某一等级/晋阶下的基础属性 */
export function levelStats(values, level, ascension) {
  const row = values[Math.min(ascension, values.length - 1)] ?? {};
  const pick = (key) => {
    const p = row[key];
    return p ? p[0] + p[1] * (level - 1) : 0;
  };
  return {
    hp: pick('hp'),
    atk: pick('atk'),
    def: pick('def'),
    spd: pick('spd'),
    cr: row.crit_rate ? row.crit_rate[0] : 0.05,
    cd: row.crit_dmg ? row.crit_dmg[0] : 0.5,
    taunt: pick('taunt'),
  };
}

function createAcc() {
  return {
    hpFlat: 0,
    atkFlat: 0,
    defFlat: 0,
    spdFlat: 0,
    hpPct: 0,
    atkPct: 0,
    defPct: 0,
    spdPct: 0,
    cr: 0,
    cd: 0,
    ehr: 0,
    res: 0,
    be: 0,
    err: 0,
    heal: 0,
    elation: 0,
    dmgAll: 0,
    dmgPhysical: 0,
    dmgFire: 0,
    dmgIce: 0,
    dmgThunder: 0,
    dmgWind: 0,
    dmgQuantum: 0,
    dmgImaginary: 0,
    sources: [],
  };
}

function apply(acc, type, value, source) {
  if (!Number.isFinite(value) || value === 0) return;
  const key = PROPERTY_MAP[type];
  if (!key) return;
  acc[key] += value;
  acc.sources.push({ source: source ?? '', type, value });
}

/** 取某件遗器的主词条数值（base + step × 强化等级） */
export function relicMainValue(db, slot, relic) {
  if (!relic?.setId || !relic.mainType) return { type: relic?.mainType, value: 0 };
  const options = db.mainAffixOptions(relic.setId, slot.type, relic.rarity ?? 5);
  const opt = options.find((o) => o.type === relic.mainType);
  if (!opt) return { type: relic.mainType, value: 0 };
  const level = Math.max(0, Math.min(relic.level ?? 0, 15));
  return { type: opt.type, value: opt.base + opt.step * level };
}

/**
 * 计算最终面板。
 * @param {object} db      buildDb() 的产物
 * @param {object} state   当前配装状态（见 state.js）
 */
export function computePanel(db, state) {
  const char = db.charById.get(state.characterId);
  if (!char) throw new Error(`未知角色 ${state.characterId}`);

  const asc = ascensionForLevel(state.level);
  const charBase = levelStats(char.stats, state.level, asc);

  const lc = state.lightConeId ? db.lcById.get(state.lightConeId) : null;
  const lcBase = lc
    ? levelStats(lc.stats, state.lcLevel ?? 80, ascensionForLevel(state.lcLevel ?? 80))
    : { hp: 0, atk: 0, def: 0, spd: 0 };

  const base = {
    hp: charBase.hp + lcBase.hp,
    atk: charBase.atk + lcBase.atk,
    def: charBase.def + lcBase.def,
    spd: charBase.spd,
  };

  const acc = createAcc();

  // 1) 行迹（小行迹，默认全部点亮；加强角色按当前技能模板取对应的一套）
  const traces =
    state.skillMode === 'enhanced' && char.enhancedTraces ? char.enhancedTraces : char.mainTraces;
  for (const trace of traces) {
    if (state.minorEnabled?.[trace.id] === false) continue;
    for (const lv of trace.levels) {
      for (const [type, value] of lv.properties) apply(acc, type, value, `行迹·${trace.name || trace.id}`);
    }
  }

  // 2) 遗器主词条 + 副词条
  const setCount = { cavern: {}, planar: {} };
  for (const slot of RELIC_SLOTS) {
    const relic = state.relics?.[slot.key];
    if (!relic?.setId) continue;
    const kind = slot.kind;
    setCount[kind][relic.setId] = (setCount[kind][relic.setId] ?? 0) + 1;

    const main = relicMainValue(db, slot, relic);
    apply(acc, main.type, main.value, `主词条·${slot.label}`);

    for (const sub of relic.subs ?? []) {
      if (!sub?.type) continue;
      apply(acc, sub.type, Number(sub.value) || 0, `副词条·${slot.label}`);
    }
  }

  // 3) 套装效果（只计无条件词条；条件加成走「手动增益」）
  const activeSets = [];
  for (const [setId, count] of Object.entries(setCount.cavern)) {
    const set = db.setById.get(setId);
    if (!set) continue;
    if (count >= 2 && set.properties?.[0]?.length) {
      for (const [type, value] of set.properties[0]) apply(acc, type, value, `套装·${set.name}(2)`);
      activeSets.push({ id: setId, name: set.name, pieces: 2, desc: set.desc?.[0] ?? '' });
    }
    if (count >= 4 && set.properties?.[1]?.length) {
      for (const [type, value] of set.properties[1]) apply(acc, type, value, `套装·${set.name}(4)`);
      activeSets.push({ id: setId, name: set.name, pieces: 4, desc: set.desc?.[1] ?? '' });
    }
  }
  for (const [setId, count] of Object.entries(setCount.planar)) {
    const set = db.setById.get(setId);
    if (!set || count < 2) continue;
    if (set.properties?.[0]?.length) {
      for (const [type, value] of set.properties[0]) apply(acc, type, value, `套装·${set.name}(2)`);
      activeSets.push({ id: setId, name: set.name, pieces: 2, desc: set.desc?.[0] ?? '' });
    }
  }

  // 4) 手动增益（模拟战斗内 buff，输入单位为 %）
  const buffs = state.buffs ?? {};
  const pct = (v) => (Number(v) || 0) / 100;
  apply(acc, 'HPAddedRatio', pct(buffs.hpPct), '手动增益');
  apply(acc, 'AttackAddedRatio', pct(buffs.atkPct), '手动增益');
  apply(acc, 'DefenceAddedRatio', pct(buffs.defPct), '手动增益');
  apply(acc, 'SpeedAddedRatio', pct(buffs.spdPct), '手动增益');
  apply(acc, 'SpeedDelta', Number(buffs.spdFlat) || 0, '手动增益');
  apply(acc, 'CriticalChanceBase', pct(buffs.cr), '手动增益');
  apply(acc, 'CriticalDamageBase', pct(buffs.cd), '手动增益');
  apply(acc, 'AllDamageTypeAddedRatio', pct(buffs.dmg), '手动增益');
  apply(acc, 'StatusProbabilityBase', pct(buffs.ehr), '手动增益');
  apply(acc, 'SPRatioBase', pct(buffs.err), '手动增益');
  apply(acc, 'BreakDamageAddedRatioBase', pct(buffs.be), '手动增益');

  // 5) 额外属性（用于词条收益排行等临时模拟）
  for (const extra of state.extraProperties ?? []) {
    apply(acc, extra.type, Number(extra.value) || 0, extra.source ?? '额外属性');
  }

  const panel = {
    hp: base.hp * (1 + acc.hpPct) + acc.hpFlat,
    atk: base.atk * (1 + acc.atkPct) + acc.atkFlat,
    def: base.def * (1 + acc.defPct) + acc.defFlat,
    spd: base.spd * (1 + acc.spdPct) + acc.spdFlat,
    cr: charBase.cr + acc.cr,
    cd: charBase.cd + acc.cd,
    ehr: acc.ehr,
    res: acc.res,
    be: acc.be,
    err: 1 + acc.err,
    heal: acc.heal,
  };

  const dmgBonus = {};
  for (const [element, key] of Object.entries(ELEMENT_DMG_KEYS)) {
    dmgBonus[element] = 1 + acc.dmgAll + acc[key];
  }

  return { char, lightCone: lc, base, panel, dmgBonus, activeSets, acc };
}

/** 面板数值格式化 */
export function formatPanelValue(value, kind, digits) {
  if (!Number.isFinite(value)) return '—';
  if (kind === 'percent') return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(digits ?? 0);
}
