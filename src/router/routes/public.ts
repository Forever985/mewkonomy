import type { RouteRecordRaw } from "vue-router"
import locale from "@/locales"

const Layouts = () => import("@/layouts/index.vue")
const { t } = locale.global

/**
 * 公开路由配置
 *
 * 说明：本文件的页面只保留「公开版也必须存在」的基础路由与站外链接。
 * 业务页面（利润排行 / 强化系列 / 生产炼金 / 打野系列）全部注册在 private.ts，
 * 因为本 fork 定位为纯本地自用完整版（`pnpm dev` = private 模式），
 * 曾经「同一页面在 public.ts 与 private.ts 各注册一份」会造成同名路由重复注册，
 * 侧边栏也会出现顺序错乱的重复入口——现已统一收敛到 private.ts。
 */
export const publicRoutes: RouteRecordRaw[] = [
  {
    path: "/redirect",
    component: Layouts,
    meta: {
      hidden: true
    },
    children: [
      {
        path: ":path(.*)",
        component: () => import("@/pages/redirect/index.vue")
      }
    ]
  },
  {
    path: "/403",
    component: () => import("@/pages/error/403.vue"),
    meta: {
      hidden: true
    }
  },
  {
    path: "/404",
    component: () => import("@/pages/error/404.vue"),
    meta: {
      hidden: true
    },
    alias: "/:pathMatch(.*)*"
  },
  {
    path: "/link",
    meta: {
      title: t("相关链接"),
      elIcon: "Link"
    },
    children: [
      {
        path: "https://github.com/luyh7/milkonomy",
        component: () => {},
        name: "Link0",
        meta: {
          title: "MewKonomy Source Code"
        }
      },
      {
        path: "https://www.milkywayidle.com/",
        component: () => {},
        name: "Link1",
        meta: {
          title: "Milky Way Idle"
        }
      },
      {
        path: "https://test-ctmd6jnzo6t9.feishu.cn/docx/KG9ddER6Eo2uPoxJFkicsvbEnCe",
        component: () => {},
        name: "Link2",
        meta: {
          title: "牛牛手册(攻略/插件)"
        }
      },
      {
        path: "https://github.com/holychikenz/MWIApi",
        component: () => {},
        name: "Link3",
        meta: {
          title: "MWI Api"
        }
      },
      {
        path: "https://docs.google.com/spreadsheets/d/13yBy3oQkH5N4y7UJ0Pkux2A8O5xM1ZsVTNAg6qgLEcM/edit?gid=2017655058#gid=2017655058",
        component: () => {},
        name: "Link4",
        meta: {
          title: "MWI Data"
        }
      }
    ]
  }
]
