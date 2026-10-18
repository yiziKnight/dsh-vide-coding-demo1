/**
 * src/core/constants.js
 * 属性映射、晋阶规则、遗器槽位等常量。
 */

export const MAX_LEVEL = 80;

/** 各晋阶阶段（0–6）的等级上限，用于「等级 → 晋阶」推导 */
export const ASCENSION_CAPS = [20, 30, 40, 50, 60, 70, 80];

/** 晋阶 0–6 的等级区间（含端点）：用于 UI 提示 */
export const ASCENSION_RANGES = [
  [1, 20],
  [20, 30],
  [30, 40],
  [40, 50],
  [50, 60],
  [60, 70],
  [70, 80],
];

/**
 * 由等级推导晋阶阶段。
 * 1–20 → 0；21–30 → 1；…；71–80 → 6。
 */
export function ascensionForLevel(level) {
  if (level <= 20) return 0;
  for (let p = 1; p <= 6; p++) {
    if (level <= ASCENSION_CAPS[p]) return p;
  }
  return 6;
}

/** 遗器槽位定义：key 用于状态，type 对应数据里的部件类型
 *  注意：数据里位面球 = NECK（主词条为属性增伤），连结绳 = OBJECT（主词条为击破/充能） */
export const RELIC_SLOTS = [
  { key: 'head', type: 'HEAD', label: '头部', kind: 'cavern', fixedMain: 'HPDelta', index: 1 },
  { key: 'hand', type: 'HAND', label: '手部', kind: 'cavern', fixedMain: 'AttackDelta', index: 2 },
  { key: 'body', type: 'BODY', label: '躯干', kind: 'cavern', index: 3 },
  { key: 'feet', type: 'FEET', label: '脚部', kind: 'cavern', index: 4 },
  { key: 'sphere', type: 'NECK', label: '位面球', kind: 'planar', index: 5 },
  { key: 'rope', type: 'OBJECT', label: '连结绳', kind: 'planar', index: 6 },
];

/** 四件套 / 两件套分别取 properties 的哪一项 */
export const SET_PIECE_COUNT = { cavern2: 2, cavern4: 4, planar2: 2 };

/**
 * 游戏属性类型 → 内部累加键。
 * - xxxDelta      → 固定值（平值）
 * - xxxAddedRatio  → 百分比（基于基础白字）
 * - xxxBase        → 百分比（游戏里同样作用于对应栏位）
 */
export const PROPERTY_MAP = {
  // 基础三围
  HPDelta: 'hpFlat',
  AttackDelta: 'atkFlat',
  DefenceDelta: 'defFlat',
  SpeedDelta: 'spdFlat',
  HPAddedRatio: 'hpPct',
  AttackAddedRatio: 'atkPct',
  DefenceAddedRatio: 'defPct',
  SpeedAddedRatio: 'spdPct',

  // 百分比类
  CriticalChanceBase: 'cr',
  CriticalChance: 'cr',
  CriticalDamageBase: 'cd',
  CriticalDamage: 'cd',
  StatusProbabilityBase: 'ehr',
  StatusProbability: 'ehr',
  StatusResistanceBase: 'res',
  StatusResistance: 'res',
  BreakDamageAddedRatioBase: 'be',
  BreakDamageAddedRatio: 'be',
  SPRatioBase: 'err',
  SPRatio: 'err',
  HealRatioBase: 'heal',
  HealRatio: 'heal',
  ElationDamageAddedRatioBase: 'elation',
  ElationDamageAddedRatio: 'elation',
  AllDamageTypeAddedRatio: 'dmgAll',
};

/** 元素 → 伤害加成累加键 */
export const ELEMENT_DMG_KEYS = {
  Physical: 'dmgPhysical',
  Fire: 'dmgFire',
  Ice: 'dmgIce',
  Thunder: 'dmgThunder',
  Wind: 'dmgWind',
  Quantum: 'dmgQuantum',
  Imaginary: 'dmgImaginary',
};

for (const [element, key] of Object.entries(ELEMENT_DMG_KEYS)) {
  PROPERTY_MAP[`${element}AddedRatio`] = key;
}

/** 面板展示用的属性列表 */
export const PANEL_ROWS = [
  { key: 'hp', label: '生命值', kind: 'flat' },
  { key: 'atk', label: '攻击力', kind: 'flat' },
  { key: 'def', label: '防御力', kind: 'flat' },
  { key: 'spd', label: '速度', kind: 'flat', digits: 1 },
  { key: 'cr', label: '暴击率', kind: 'percent' },
  { key: 'cd', label: '暴击伤害', kind: 'percent' },
  { key: 'ehr', label: '效果命中', kind: 'percent' },
  { key: 'res', label: '效果抵抗', kind: 'percent' },
  { key: 'be', label: '击破特攻', kind: 'percent' },
  { key: 'err', label: '能量恢复效率', kind: 'percent' },
  { key: 'heal', label: '治疗量加成', kind: 'percent' },
];

/** 手动增益（模拟战斗内 buff）字段定义 */
export const BUFF_FIELDS = [
  { key: 'hpPct', label: '生命%', unit: '%' },
  { key: 'atkPct', label: '攻击%', unit: '%' },
  { key: 'defPct', label: '防御%', unit: '%' },
  { key: 'spdPct', label: '速度%', unit: '%' },
  { key: 'spdFlat', label: '速度固定', unit: '' },
  { key: 'cr', label: '暴击率', unit: '%' },
  { key: 'cd', label: '暴击伤害', unit: '%' },
  { key: 'dmg', label: '增伤', unit: '%' },
  { key: 'ehr', label: '效果命中', unit: '%' },
  { key: 'err', label: '能量恢复', unit: '%' },
  { key: 'be', label: '击破特攻', unit: '%' },
];
