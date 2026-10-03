/**
 * 「多变搜索」面板的配置模型
 *
 * 背景：11 个检索页各自手写了一份搜索表单，实测重复度极高 ——
 *   jungle/decompose/inherit/junglest 系列两两相似度 91%~100%，
 *   dashboard 与 manualchemy 94%，enhanposer 与 enhanposest 100%。
 *   其中 13 个字段（name / conditions / banEquipment / minProfitRate / maxProfitRate /
 *   banJewelry / banCharm / banCombat / banLife / maxRisk / minLevel / maxLevel / excludes）
 *   在 9~11 个页面里反复出现，差异只在「标签文案 + 取值范围 + 显示与否」。
 *
 * 于是把「有哪些字段、各自的文案与边界」抽成纯配置（本文件），
 * 由 SearchPanel 组件统一渲染。页面只声明配置，不再各自手写模板。
 *
 * 设计原则：
 * - 面板**不改动传入的数据结构**：自己负责增删 conditions / excludes 的行，
 *   取值范围（min/max）由配置给出，其余一律透传。
 * - 所有变更统一 emit("change")，页面据此触发检索（与原先 @change="handleSearchLD" 等价）。
 * - 字段的展示条件用 `when`，避免为一个页面特例写死。
 */

/** 项目（动作）下拉可选项：直接给字符串数组，或给求值函数 */
export type PanelProjectOptions = string[] | (() => string[])

/** 分页检索页共用的搜索数据结构 */
export interface PanelSearchData {
  name?: string[]
  /** 组合条件行：每行「步数/等级 + 动作」，行间为 OR */
  conditions?: Array<{ steps?: number | string, project?: string, minLevel?: number, maxLevel?: number }>
  /** 反向排除行：{ 产品名, 生产动作 } */
  excludes?: Array<{ name?: string, project?: string }>
  minProfitRate?: number
  maxProfitRate?: number
  minRisk?: number
  maxRisk?: number
  minLevel?: number
  maxLevel?: number
  /**
   * 区间字段的**模式**等元数据走 `${minKey}__mode` / `__max` / `__tolerance` 这几个键
   * （由末尾的索引签名容纳），由 `SearchPanel` 自动维护，页面与 `handleSearch` 一般不必碰。
   */
  banEquipment?: boolean
  banJewelry?: boolean
  banCharm?: boolean
  banCombat?: boolean
  banLife?: boolean
  compare?: boolean
  materialPriceType?: string
  productPriceType?: string
  sortRules?: unknown
  /** 各页自己的特有字段，配置里用自定义 key 引用 */
  [key: string]: unknown
}

/** 字段通用属性 */
interface FieldBase {
  /** 在 searchData 上的字段名（区间字段除外） */
  key?: string
  label: string
  /**
   * 标签前缀/后缀（不翻译，用于拼出「风险 ≤」「目标等级从」这类带符号的标签）。
   * 之所以单独拆出来而不是直接在 label 里拼接：label 若写成 `${t("风险")} ≤`，
   * t() 会在 setup 阶段求值一次，切换语言时不会更新；这里在模板里拼接才能保持响应式。
   */
  labelPrefix?: string
  labelSuffix?: string
  /** 返回 false 时不渲染该字段 */
  when?: () => boolean
}

/**
 * 数值区间。
 *
 * ## 模式（2026-10-03 新增）
 *
 * 改造前只能表达「`minKey` ~ `maxKey`」一种语义（等价于现在的 `between`），
 * 用户想筛「至少 20%」或「排除 1000~2000」就得手算并凑成区间。
 * 现支持全部 9 种模式（与市场监控页共用 `RangeFilter` 组件与判定实现）：
 *
 * | mode | 含义 |
 * | --- | --- |
 * | 不限 | 关闭该条件（默认） |
 * | ≥ / ≤ | 不低于 / 不高于（含端点） |
 * | 区间 | 在两者之间（含两端）—— **改造前唯一能表达的模式** |
 * | 区间之外 | 排除中间那段 |
 * | 接近 | 目标值 ± 容差 |
 * | = | 等于（浮点带容差） |
 * | 前 N / 后 N | 该字段最大/最小的 N 条 |
 *
 * ## 向后兼容
 *
 * **不写 `modes` 的字段行为完全不变**：模式数据存放在 `${minKey}__mode`
 * （以及 `__max` / `__tolerance`），而 `minKey` / `maxKey` 两个平铺字段照旧读写，
 * 所以页面声明与 `handleSearch` 的旧用法都不需要改。
 */
export interface RangeField extends FieldBase {
  type: "range"
  minKey?: string
  maxKey: string
  /** 区间分隔符，默认 "~" */
  separator?: string
  /** 单位后缀，默认无。只写 "M" 这类纯单位；"%"" 会渲染成 `&nbsp;%`（与旧模板一致） */
  unit?: string
  placeholderMin?: string
  placeholderMax?: string
  min?: number
  max?: number
  width?: number
  /** 步长（RangeFilter 用），默认 1 */
  step?: number
  /** 小数位，默认 0 */
  precision?: number
  /**
   * 允许的模式子集。**不写 = 全部 9 种**（用户要求「可以不用，但不能没有」）。
   * 写了则只列这些，按给定顺序显示。
   */
  modes?: Array<"any" | "gte" | "lte" | "between" | "outside" | "near" | "eq" | "topN" | "bottomN">
}

/** 条件行：可增删的多行「步数/等级 + 动作」 */
export interface ConditionsField extends FieldBase {
  type: "conditions"
  /** 行数下限，低于该值不显示删除按钮；默认 1 */
  minRows?: number
  /** 首列下拉的取值范围上界，默认 20 */
  stepsCount?: number
  /** 首列展示模板，默认 `${t("目标等级")} ${n}` */
  stepLabel?: (n: number) => string
  /** 首列宽度（px），默认 130；manualchemy 用 92 */
  stepsWidth?: number
  /** 动作下拉宽度（px），默认 130；manualchemy 用 110 */
  projectWidth?: number
  stepsPlaceholder?: string
  projectPlaceholder?: string
  /**
   * 动作下拉的可选项。
   * `levelRange` 型条件（enhanceexp 的「只看目标等级」）没有动作列，故为可选。
   */
  projectOptions?: PanelProjectOptions
  /** 是否渲染右侧的 min/max 等级输入（enhanceexp 用） */
  levelRange?: { min: number, max: number, placeholderMin?: string, placeholderMax?: string }
  /** 行下方的小字提示 */
  hint?: string
}

/** 排除行：可增删的多行「产品名 + 生产动作」 */
export interface ExcludesField extends FieldBase {
  type: "excludes"
  minRows?: number
  namePlaceholder?: string
  projectPlaceholder?: string
  projectOptions: PanelProjectOptions
}

/** 复选开关 */
export interface CheckboxField extends FieldBase {
  type: "checkbox"
  key: string
  /** 只读展示（如 jungle/pickout 的「最佳制作方案」，原模板即 disabled） */
  disabled?: boolean
  /**
   * 额外的变更回调（在组件 emit("change") 之后调用）。
   * 用于像 junglest/inherit 的 noEscape 这种「切换后除了重新检索、还要清计算模式缓存」的特例。
   */
  onChange?: () => void
}

/** 下拉选项：静态数组（字符串数组会被翻译后转成 label/value），或（可能是 computed 的）取值函数 */
export type PanelOptionSource =
  | Array<{ label: string, value: string | number }>
  | string[]
  | (() => Array<{ label: string, value: string | number }> | string[])

/** 下拉选择 */
export interface SelectField extends FieldBase {
  type: "select"
  key: string
  options: PanelOptionSource
  width?: number
}

/** 排序优先级编辑器 */
export interface SortField extends FieldBase {
  type: "sort"
  key: string
  fields: Array<{ prop: string, label: string, formatted?: boolean }>
  defaultProp?: string
}

/** 物品名多选（可自由输入） */
export interface NameField extends FieldBase {
  type: "name"
  key: string
  width?: number
  placeholder?: string
}

export type PanelField =
  | NameField
  | ConditionsField
  | ExcludesField
  | RangeField
  | CheckboxField
  | SelectField
  | SortField

/** 一个页面的完整面板配置 */
export interface PanelConfig {
  /** 面板标题（卡片左上角），如「利润排行」 */
  title?: string
  fields: PanelField[]
}
