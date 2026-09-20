import { defineStore } from "pinia"
import { getItemDetailOf } from "@/common/apis/game"

export const useEnhancerStore = defineStore("enhancer", {
  state: () => ({
    config: loadConfig(),
    advancedConfig: loadAdvancedConfig(),
    favorite: loadFavorite(),
    advancedFavorite: loadAdvancedFavorite()
  }),
  actions: {
    saveConfig() {
      saveConfig(this.config)
    },
    saveAdvancedConfig() {
      saveAdvancedConfig(this.advancedConfig)
    },
    addFavorite(hrid: string) {
      if (!hrid) return
      const index = this.favorite.indexOf(hrid)
      if (index === -1) {
        this.favorite.push(hrid)
      }
      this.favorite.sort((a, b) => getItemDetailOf(a).sortIndex - getItemDetailOf(b).sortIndex)
      saveFavorite(this.favorite)
    },
    removeFavorite(hrid: string) {
      if (!hrid) return
      const index = this.favorite.indexOf(hrid)
      if (index !== -1) {
        this.favorite.splice(index, 1)
      }
      saveFavorite(this.favorite)
    },
    hasFavorite(hrid: string) {
      if (!hrid) return false
      const index = this.favorite.indexOf(hrid)
      return index !== -1
    },
    addAdvancedFavorite(hrid: string) {
      if (!hrid) return
      const index = this.advancedFavorite.indexOf(hrid)
      if (index === -1) {
        this.advancedFavorite.push(hrid)
      }
      this.advancedFavorite.sort((a, b) => getItemDetailOf(a).sortIndex - getItemDetailOf(b).sortIndex)
      saveAdvancedFavorite(this.advancedFavorite)
    },
    removeAdvancedFavorite(hrid: string) {
      if (!hrid) return
      const index = this.advancedFavorite.indexOf(hrid)
      if (index !== -1) {
        this.advancedFavorite.splice(index, 1)
      }
      saveAdvancedFavorite(this.advancedFavorite)
    },
    hasAdvancedFavorite(hrid: string) {
      if (!hrid) return false
      const index = this.advancedFavorite.indexOf(hrid)
      return index !== -1
    }
  },
  getters: {
    enhanceLevel: state => state.config.enhanceLevel,
    hourlyRate: state => state.config.hourlyRate,
    taxRate: state => state.config.taxRate,
    hrid: state => state.config.hrid,
    originLevel: state => state.config.originLevel,
    escapeLevel: state => state.config.escapeLevel
  }
})

export interface EnhancerConfig {
  escapeLevel?: number
  originLevel?: number
  enhanceLevel?: number
  hourlyRate?: number
  taxRate?: number
  hrid?: string
  tab?: string
  /** 鏈瑕佸己鍖栫殑鍚岀瑁呭浠舵暟锛堟潗鏂欎笌鏈綋鎸変欢鏁版眹鎬伙級 */
  pieceCount?: number
  /**
   * 鏈熸湜鎴愬姛绯绘暟锛歚1` = 鎸夐┈灏旂澶摼绠楀嚭鐨勩€屽钩鍧囨湡鏈涙鏁般€嶏紱
   * `1.2` = 鍋囪鑷繁鍦?1.2 鍊嶆湡鏈涘墠鍚庢墠鎴愬姛锛屾潗鏂欎笌淇濇姢娑堣€楁暣浣撲笂娴?20%銆?   */
  expectationFactor?: number
}
const KEY_PREFIX = "enhancer-"
function loadConfig(): EnhancerConfig {
  try {
    return JSON.parse(localStorage.getItem(`${KEY_PREFIX}config`) || "{}")
  } catch {
    return {}
  }
}

function saveConfig(item: EnhancerConfig) {
  localStorage.setItem(`${KEY_PREFIX}config`, JSON.stringify(item))
}

function loadAdvancedConfig(): EnhancerConfig {
  try {
    return JSON.parse(localStorage.getItem(`${KEY_PREFIX}advancedConfig`) || "{}")
  } catch {
    return {}
  }
}
function saveAdvancedConfig(item: EnhancerConfig) {
  localStorage.setItem(`${KEY_PREFIX}advancedConfig`, JSON.stringify(item))
}

function loadFavorite(): string[] {
  try {
    return JSON.parse(localStorage.getItem(`${KEY_PREFIX}favorite`) || "[]")
  } catch {
    return []
  }
}
function saveFavorite(item: string[]) {
  localStorage.setItem(`${KEY_PREFIX}favorite`, JSON.stringify(item))
}

function loadAdvancedFavorite(): string[] {
  try {
    return JSON.parse(localStorage.getItem(`${KEY_PREFIX}advancedFavorite`) || "[]")
  } catch {
    return []
  }
}
function saveAdvancedFavorite(item: string[]) {
  localStorage.setItem(`${KEY_PREFIX}advancedFavorite`, JSON.stringify(item))
}
