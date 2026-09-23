/* eslint-disable perfectionist/sort-imports */

// core
import { pinia } from "@/pinia"
import { router } from "@/router"
import { installPlugins } from "@/plugins"
import App from "@/App.vue"

// css
import "element-plus/dist/index.css"
import "normalize.css"
import "nprogress/nprogress.css"
import "element-plus/theme-chalk/dark/css-vars.css"
import "@@/assets/styles/index.scss"
import "virtual:uno.css"
import { useGameStoreOutside } from "./pinia/stores/game"
import { startMarketAutoSampling } from "@@/apis/marketvolume/history"

import locales from "@/locales"

import VueGtag, { trackRouter } from "vue-gtag-next"

// 创建应用实例
const app = createApp(App)

// 安装插件（全局组件、自定义指令等）
installPlugins(app)

// 国际化
app.use(locales)

trackRouter(router)
// 安装 pinia 和 router
app.use(pinia).use(router)

// 定时获取数据
setInterval(() => {
  useGameStoreOutside().tryFetchData()
}, 60 * 1000)

// 市场历史自动采样：官方快照是整点小时粒度，而上面每 60s 就会轮询一次官方
// marketplace.json，所以只要页面开着，快照一前进就会在 1 分钟内被记成一个采样点。
// 这是唯一能真正做到「每小时一个点」的通道 —— GitHub Actions 的 schedule 是
// best-effort 的（本仓库实测声明 60min、实际中位 307min）。
// 放在应用层而不是市场监控页内，是为了「开着任意页面都在采样」。
startMarketAutoSampling()

app.use(VueGtag, {
  property: {
    id: "G-XHFS0BRE7Y"
  }
})

useGameStoreOutside().tryFetchData().then(() => {
  router.isReady().then(() => {
    app.mount("#app")
  })
})
