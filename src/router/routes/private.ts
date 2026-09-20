import type { RouteRecordRaw } from "vue-router"
import locale from "@/locales"

const Layouts = () => import("@/layouts/index.vue")
const { t } = locale.global

/**
 * 私有路由配置（侧边栏分组顺序 = 本数组顺序）
 *
 * 分组原则：按「用户要回答的问题」分组，而不是按技术实现分组。
 *   1. 利润检索  —— 做什么最赚（全局排行 + 市场行情）
 *   2. 强化      —— 强化到 X 值不值（普通 / 超级）
 *   3. 强化分解  —— 强化到 X 再分解值不值（普通 / 超级）
 *   4. 生产炼金  —— 采集→制作→炼金 这条链怎么排最赚（固定模板 / 自由拼链 / 护符）
 *   5. 打野      —— 野外刷取的收益与去向（打野 / 打野强化 / 继承 / 分解 / 捡漏）
 *   6. 使用文档
 *
 * 约定：多子路由的根路由必须给 meta.title + meta.elIcon 才会渲染成 el-sub-menu；
 * 单子路由的根路由只是占位（meta 不参与渲染），子路由 meta 才是菜单项。
 */
export const privateRoutes: RouteRecordRaw[] = [
  // ==================== 1. 利润检索 ====================
  {
    path: "/",
    component: Layouts,
    redirect: "/dashboard",
    meta: {
      title: t("利润检索"),
      elIcon: "TrendCharts"
    },
    children: [
      {
        path: "dashboard",
        component: () => import("@/pages/dashboard/index.vue"),
        name: "Dashboard",
        meta: {
          title: t("利润排行"),
          affix: true,
          elIcon: "TrendCharts"
        }
      },
      {
        path: "marketvolume",
        component: () => import("@/pages/marketvolume/index.vue"),
        name: "Marketvolume",
        meta: {
          title: t("市场监控"),
          affix: false,
          elIcon: "DataLine"
        }
      },
      {
        path: "docs",
        component: () => import("@/pages/docs/index.vue"),
        name: "Docs",
        meta: {
          title: t("使用文档"),
          affix: false,
          elIcon: "Document"
        }
      },
      {
        // 从 public.ts 迁入：本站为私有完整版，打赏页与其它私有页同属「关于本站」，
        // 且冻结守卫的兜底重定向目标指向 Sponsor，私有侧必须保证该路由已注册
        path: "sponsor",
        component: () => import("@/pages/sponsor/index.vue"),
        name: "Sponsor",
        meta: {
          title: t("打赏"),
          affix: false,
          elIcon: "Coin"
        }
      }
    ]
  },

  // ==================== 2. 强化 ====================
  {
    path: "/",
    component: Layouts,
    redirect: "/enhancer",
    meta: {
      title: t("强化"),
      elIcon: "MagicStick"
    },
    children: [
      {
        path: "enhancer",
        component: () => import("@/pages/enhancer/index.vue"),
        name: "Enhancer",
        meta: {
          title: t("强化计算"),
          affix: false,
          elIcon: "MagicStick"
        }
      },
      {
        path: "enhancest",
        component: () => import("@/pages/enhancest/index.vue"),
        name: "Enhancest",
        meta: {
          title: t("超级强化计算"),
          affix: false,
          elIcon: "MagicStick"
        }
      }
    ]
  },

  // ==================== 3. 强化分解 ====================
  {
    path: "/",
    component: Layouts,
    redirect: "/enhanposer",
    meta: {
      title: t("强化分解"),
      elIcon: "ScaleToOriginal"
    },
    children: [
      {
        path: "enhanposer",
        component: () => import("@/pages/enhanposer/index.vue"),
        name: "Enhanposer",
        meta: {
          title: t("强化分解"),
          affix: false,
          elIcon: "ScaleToOriginal"
        }
      },
      {
        path: "enhanposest",
        component: () => import("@/pages/enhanposer/enhanposest.vue"),
        name: "Enhanposest",
        meta: {
          title: t("超级强化分解"),
          affix: false,
          elIcon: "ScaleToOriginal"
        }
      }
    ]
  },

  // ==================== 4. 生产炼金 ====================
  {
    path: "/",
    component: Layouts,
    redirect: "/manualchemy",
    meta: {
      title: t("生产炼金"),
      elIcon: "Opportunity"
    },
    children: [
      {
        path: "manualchemy",
        component: () => import("@/pages/manualchemy/index.vue"),
        name: "Manualchemy",
        meta: {
          title: t("制作炼金"),
          affix: false,
          elIcon: "Opportunity"
        }
      },
      {
        path: "chainbuilder",
        component: () => import("@/pages/chainbuilder/index.vue"),
        name: "Chainbuilder",
        meta: {
          title: t("手动产业链"),
          affix: false,
          elIcon: "Connection"
        }
      },
      {
        path: "charmtransform",
        component: () => import("@/pages/charmtransform/index.vue"),
        name: "Charmtransform",
        meta: {
          title: t("护符转化盈利"),
          affix: false,
          elIcon: "Coin"
        }
      }
    ]
  },

  // ==================== 5. 打野 ====================
  {
    path: "/",
    component: Layouts,
    redirect: "/jungle",
    meta: {
      title: t("打野"),
      elIcon: "Compass"
    },
    children: [
      {
        path: "jungle",
        component: () => import("@/pages/jungle/index.vue"),
        name: "Jungle",
        meta: {
          title: t("打野工具"),
          affix: false,
          elIcon: "Compass"
        }
      },
      {
        path: "junglest",
        component: () => import("@/pages/junglest/index.vue"),
        name: "junglest",
        meta: {
          title: t("超级打野工具"),
          affix: false,
          elIcon: "Compass"
        }
      },
      {
        path: "junglerit",
        component: () => import("@/pages/junglest/inherit.vue"),
        name: "junglerit",
        meta: {
          title: t("继承打野工具"),
          affix: false,
          elIcon: "Compass"
        }
      },
      {
        path: "inherit",
        component: () => import("@/pages/inherit/index.vue"),
        name: "inherit",
        meta: {
          title: t("继承"),
          affix: false,
          elIcon: "Compass"
        }
      },
      {
        path: "decompose",
        component: () => import("@/pages/decompose/index.vue"),
        name: "decompose",
        meta: {
          title: t("分解"),
          affix: false,
          elIcon: "Compass"
        }
      },
      {
        path: "pickout",
        component: () => import("@/pages/jungle/pickout.vue"),
        name: "Pickout",
        meta: {
          title: t("捡漏工具"),
          affix: false,
          elIcon: "Compass"
        }
      }
    ]
  },

  // ==================== 6. 打赏 / 示例（隐藏） ====================
  {
    path: "/demo",
    component: Layouts,
    redirect: "/demo/unocss",
    name: "Demo",
    meta: {
      title: "示例集合",
      elIcon: "DataBoard",
      hidden: true
    },
    children: [
      {
        path: "unocss",
        component: () => import("@/pages/demo/unocss/index.vue"),
        name: "UnoCSS",
        meta: {
          title: "UnoCSS"
        }
      },
      {
        path: "level2",
        component: () => import("@/pages/demo/level2/index.vue"),
        redirect: "/demo/level2/level3",
        name: "Level2",
        meta: {
          title: "二级路由",
          alwaysShow: true
        },
        children: [
          {
            path: "level3",
            component: () => import("@/pages/demo/level2/level3/index.vue"),
            name: "Level3",
            meta: {
              title: "三级路由",
              keepAlive: true
            }
          }
        ]
      },
      {
        path: "composable-demo",
        redirect: "/demo/composable-demo/use-fetch-select",
        name: "ComposableDemo",
        meta: {
          title: "组合式函数"
        },
        children: [
          {
            path: "use-fetch-select",
            component: () => import("@/pages/demo/composable-demo/use-fetch-select.vue"),
            name: "UseFetchSelect",
            meta: {
              title: "useFetchSelect"
            }
          },
          {
            path: "use-fullscreen-loading",
            component: () => import("@/pages/demo/composable-demo/use-fullscreen-loading.vue"),
            name: "UseFullscreenLoading",
            meta: {
              title: "useFullscreenLoading"
            }
          },
          {
            path: "use-watermark",
            component: () => import("@/pages/demo/composable-demo/use-watermark.vue"),
            name: "UseWatermark",
            meta: {
              title: "useWatermark"
            }
          }
        ]
      }
    ]
  }
]
