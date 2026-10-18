/**
 * src/core/damage.js
 * 伤害模拟 —— 纯函数，基于面板结果与敌方参数计算单次伤害。
 *
 * 公式（直伤）：
 *   基础伤害 = 技能倍率 × 攻击力(或生命上限/防御力)
 *   最终伤害 = 基础伤害
 *            × 增伤区 (1 + Σ增伤)
 *            × 暴击区 (暴击 1+CD；期望 1+CR×CD)
 *            × 防御区 (攻Lv+20) / [(攻Lv+20) + (守Lv+20)×(1−减防)×(1−无视防御)]
 *            × 抗性区 (1 − 抗性 + 穿透)
 *            × 易伤区 (1 + 易伤)
 *            × 减伤区 (1 − 减伤)
 *            × 韧性区 (未击破 0.9)
 */
import { ELEMENT_DMG_KEYS } from './constants.js';

/** 默认敌方参数 */
export const DEFAULT_ENEMY = {
  level: 80,
  res: 0.2,
  resPen: 0,
  defShred: 0,
  defIgnore: 0,
  vulnerability: 0,
  dmgReduction: 0,
  broken: false,
};

const SCALING_PATTERNS = [
  { key: 'hp', re: /生命值上限|生命上限|最大生命值/ },
  { key: 'def', re: /防御力/ },
  { key: 'atk', re: /攻击力/ },
];

export const SCALING_LABELS = { atk: '攻击力', hp: '生命上限', def: '防御力' };

/** 从技能描述里推断伤害倍率吃哪一项面板属性 */
export function skillScalingKey(skill) {
  const desc = skill?.desc ?? '';
  for (const { key, re } of SCALING_PATTERNS) {
    if (re.test(desc)) return key;
  }
  return 'atk';
}

/** 取某等级的倍率数组（每个元素是数值，单位与百分比一致，如 1.5 = 150%） */
export function skillMultipliers(skill, level) {
  const rows = skill?.params ?? [];
  if (!rows.length) return [];
  const idx = Math.max(0, Math.min(level - 1, rows.length - 1));
  const row = rows[idx];
  return Array.isArray(row) ? row : [row];
}

/** 技能造成的伤害属性（没有元素时退化为角色属性） */
export function skillElement(skill, character) {
  return skill?.element ?? character?.element ?? 'Physical';
}

/**
 * 计算伤害。
 * @param {object} panelResult computePanel() 的返回值
 * @param {object} skill       技能数据（来自 characters.json 的 skills）
 * @param {object} opts        { level, multiplier, enemy }
 */
export function computeDamage(panelResult, skill, opts) {
  const { panel, char, dmgBonus } = panelResult;
  const enemy = { ...DEFAULT_ENEMY, ...(opts.enemy ?? {}) };

  const scalingKey = opts.scalingKey ?? skillScalingKey(skill);
  const statValue = panel[scalingKey === 'hp' ? 'hp' : scalingKey === 'def' ? 'def' : 'atk'];
  const multiplier = opts.multiplier;
  const element = skillElement(skill, char);

  const dmgMul = dmgBonus[element] ?? WEAKENED_FALLBACK(dmgBonus);
  const base = statValue * multiplier;

  const defMul =
    (opts.level + 20) / ((opts.level + 20) + (enemy.level + 20) * (1 - enemy.defShred) * (1 - enemy.defIgnore));
  const resMul = 1 - enemy.res + enemy.resPen;
  const vulnMul = 1 + enemy.vulnerability;
  const redMul = 1 - enemy.dmgReduction;
  const toughnessMul = enemy.broken ? 1 : 0.9;
  const critMul = 1 + Math.max(0, panel.cd);

  const common = base * dmgMul * defMul * resMul * vulnMul * redMul * toughnessMul;
  const nonCrit = common;
  const crit = common * critMul;
  const expected = common * (1 + panel.cr * panel.cd);

  return {
    element,
    scalingKey,
    scalingLabel: SCALING_LABELS[scalingKey],
    statValue,
    multiplier,
    base,
    dmgMul,
    defMul,
    resMul,
    vulnMul,
    redMul,
    toughnessMul,
    critMul,
    nonCrit,
    crit,
    expected,
    enemy,
  };
}

/** 面板里没有该元素增伤时（理论上不会发生），退化为 1 */
function WEAKENED_FALLBACK(dmgBonus) {
  return Object.values(dmgBonus ?? {})[0] ?? 1;
}

/** 数量级格式化：12345 → 1.2 万 */
export function formatDamage(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  return Math.round(value).toLocaleString('zh-CN');
}

export { ELEMENT_DMG_KEYS };
