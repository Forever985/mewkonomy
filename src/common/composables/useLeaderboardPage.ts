import type Calculator from "@/calculator"
import type { PanelSearchData } from "@@/components/SearchPanel/types"
import type { Sort } from "element-plus"
import { useMemory } from "./useMemory"
import { usePagination } from "./usePagination"
import { usePriceStatus } from "./usePriceStatus"
import { normalizeSearchData } from "./useSearchPanel"
import { usePriceStoreOutside } from "@/pinia/stores/price"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { usePlayerStoreOutside } from "@/pinia/stores/player"
import { useRouter } from "vue-router"
import { cloneDeep, debounce } from "lodash-es"
import { ElMessageBox } from "element-plus"

/**
 * 「分页检索结果页」的骨架。
 *
 * ## 为什么要有它
 * 项目里 11 个检索页（dashboard / decompose / enhanceexp / enhanposer ×2 / inherit /
 * jungle ×2 / junglest ×2 / manualchemy）原先各自手抄了一遍同样的骨架：
 * 分页、检索条件缓存、防抖检索、条件变化回第一页、排序、自动重算 watch、
 * 详情弹窗、价格弹窗、买卖价状态 —— 实测其中 39 行的排序+检索块在 5 个文件里逐字相同，
 * 23 行的详情弹窗状态在 10 个文件里逐字相同，`jungle` 与 `junglest` 两个页面
 * 850 行里有 2/3 完全相同。改一处就得改 11 处，正是"有轮子不用"的典型。
 *
 * 抽出来之后，一个页面的骨架只剩一次调用 + 自己的 `panelFields` 配置。
 *
 * ## 用法（关键：用别名解构，模板可以一行都不用改）
 * ```ts
 * const {
 *   searchData: ldSearchData,
 *   list: leaderboardData,
 *   loading: loadingLD,
 *   paginationData: paginationDataLD,
 *   handleCurrentChange: handleCurrentChangeLD,
 *   handleSizeChange: handleSizeChangeLD,
 *   fetchData: getLeaderboardData,
 *   handleSearch: handleSearchLD,
 *   handleSortChange: handleSortLD,
 *   currentRow, detailVisible, showDetail,
 *   priceVisible, currentPriceRow, setPrice,
 *   onPriceStatusChange
 * } = useLeaderboardPage({
 *   key: "jungle",
 *   api: getDataApi,
 *   searchData: { ... }
 * })
 * ```
 *
 * ## ⚠️ 缓存 key 一定要传对
 * `key` 只用来**派生**三个 localStorage key：检索条件、分页、买卖价状态。
 * 它们决定用户的搜索条件与分页能不能跨刷新保留，**默认值必须与历史 key 完全一致**，
 * 否则用户的数据看起来"丢了"。历史 key 与派生规则不同时，逐个覆盖：
 * - `memoryKey`（默认 `${key}-leaderboard-search-data`）
 * - `paginationKey`（默认 `${key}-leaderboard-pagination`）
 * - `priceStatusKey`（默认 `${key}-price-status`）
 */
export interface LeaderboardApiResult {
  list: Calculator[]
  total: number
}

/** 传给检索接口的参数：分页 + 检索条件 + 排序 */
export interface LeaderboardQuery extends PanelSearchData {
  currentPage: number
  size: number
  sort?: Sort
}

export interface UseLeaderboardPageOptions<T extends PanelSearchData> {
  /** 缓存 key 前缀，如 `"jungle"` */
  key: string
  /**
   * 检索接口。参数是「分页 + 检索条件 + 排序」拼好的对象。
   * 需要额外实参的页面在这里包一层，例如 `params => getDataApi(params, "pickout")`。
   */
  api: (params: LeaderboardQuery) => Promise<LeaderboardApiResult>
  /** 检索条件默认值 */
  searchData: T
  /** 检索条件缓存 key 覆盖 */
  memoryKey?: string
  /** 分页缓存 key 覆盖 */
  paginationKey?: string
  /** 买卖价状态缓存 key 覆盖 */
  priceStatusKey?: string
  /** 额外要触发重算的 watch 源（除分页/市场数据/玩家配置/买卖价之外） */
  autoRefresh?: (() => unknown)[]
  /** 检索防抖毫秒，默认 300 */
  debounceMs?: number
  /** 是否接入「按页记忆买卖价」这套（默认 true）。decompose 不用，传 false */
  withPriceStatus?: boolean
}

export function useLeaderboardPage<T extends PanelSearchData>(options: UseLeaderboardPageOptions<T>) {
  const {
    key,
    api,
    searchData: defaultSearchData,
    memoryKey = `${key}-leaderboard-search-data`,
    paginationKey = `${key}-leaderboard-pagination`,
    priceStatusKey = `${key}-price-status`,
    autoRefresh = [],
    debounceMs = 300,
    withPriceStatus = true
  } = options

  const { t } = useI18n()
  const router = useRouter()

  // ── 分页 ──────────────────────────────────────────────────────────────
  const { paginationData, handleCurrentChange, handleSizeChange } = usePagination({}, paginationKey)

  // ── 检索条件（按页缓存；旧结构统一走 normalizeSearchData 迁移）──────────
  const searchData = useMemory(memoryKey, defaultSearchData)
  normalizeSearchData(searchData.value)

  // ── 检索结果 ──────────────────────────────────────────────────────────
  const list = ref<Calculator[]>([])
  const loading = ref(false)
  const sort = ref<Sort>()

  const fetchData = debounce(() => {
    loading.value = true
    api({
      currentPage: paginationData.currentPage,
      size: paginationData.pageSize,
      ...searchData.value,
      sort: sort.value
    })
      .then((data) => {
        paginationData.total = data.total
        list.value = data.list
      })
      .catch((e) => {
        console.error(e)
        list.value = []
      })
      .finally(() => {
        loading.value = false
      })
  }, debounceMs)

  /**
   * 检索条件变化时调用：**先回到第一页再查**。
   * 已经在第一页就直接查（否则改条件后会停在后面的页码上，看起来像"筛完是空的"）。
   */
  function handleSearch() {
    paginationData.currentPage === 1 ? fetchData() : (paginationData.currentPage = 1)
  }

  function handleSortChange(next: Sort) {
    sort.value = next
    fetchData()
  }

  // 分页、市场数据、玩家配置、买卖价变化都要重算；各页还可追加自己的依赖
  watch([
    () => paginationData.currentPage,
    () => paginationData.pageSize,
    () => useGameStoreOutside().marketData,
    () => usePlayerStoreOutside().config,
    () => useGameStoreOutside().buyStatus,
    () => useGameStoreOutside().sellStatus,
    ...autoRefresh
  ], fetchData, { immediate: true })

  // 自定义价格表变化（内容级改动也要重算，故 deep）
  watch(() => usePriceStoreOutside(), fetchData, { deep: true })

  // ── 详情弹窗 ──────────────────────────────────────────────────────────
  const currentRow = ref<Calculator>()
  const detailVisible = ref(false)
  /** 深拷贝一份再展示：详情弹窗里的编辑不应直接改到列表项 */
  function showDetail(row: Calculator) {
    currentRow.value = cloneDeep(row)
    detailVisible.value = true
  }

  // ── 自定义价格弹窗 ────────────────────────────────────────────────────
  const priceVisible = ref(false)
  const currentPriceRow = ref<Calculator>()
  function setPrice(row: Calculator) {
    if (!usePriceStoreOutside().activated) {
      ElMessageBox.confirm(t("是否确定开启自定义价格？"), t("需先开启自定义价格"), {
        confirmButtonText: t("确定"),
        cancelButtonText: t("取消"),
        closeOnClickModal: true
      }).then(() => {
        usePriceStoreOutside().setActivated(true)
      })
      return
    }
    currentPriceRow.value = cloneDeep(row)
    priceVisible.value = true
  }

  // ── 跳到强化计算页 ─────────────────────────────────────────────────
  /**
   * 「到强化计算页查看」：每行最后一个入口。
   *
   * ## 为什么**不传任何参数**
   *
   * 强化页的整套配置（装备 hrid / 起始等级 / 目标等级 / 逃逸等级 / 时薪 / 税率）
   * 本来就持久化在 `pinia/stores/enhancer.ts` 的 `config` 里（`saveConfig` 写
   * localStorage），**是玩家自己每个预设调好的**。所以这里只做路由跳转 ——
   * 传参过去反而会覆盖掉人家精心设好的预设。
   *
   * 这与 `usePriceStatus` 是同一类思路：**用 store 隐式带状态，而不是往地址栏塞参数**
   * （地址栏会暴露在分享链接与浏览器历史里）。
   */
  function gotoEnhancer() {
    router.push({ name: "Enhancer" })
  }

  // ── 买卖价状态（按页记忆，离开页面还原全局默认）──────────────────────
  const onPriceStatusChange = withPriceStatus ? usePriceStatus(priceStatusKey) : undefined

  return {
    searchData,
    list,
    loading,
    paginationData,
    handleCurrentChange,
    handleSizeChange,
    fetchData,
    handleSearch,
    sort,
    handleSortChange,
    currentRow,
    detailVisible,
    showDetail,
    priceVisible,
    currentPriceRow,
    setPrice,
    gotoEnhancer,
    onPriceStatusChange
  }
}
