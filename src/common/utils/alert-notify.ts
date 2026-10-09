import type { AlertHit } from "@/common/apis/marketvolume/alerts"

/**
 * 提醒的浏览器通知 —— 市场监控与炒货共用同一份实现。
 *
 * ## 为什么要抽出来
 *
 * 提醒引擎（`marketvolume/alerts`）与规则存储（`pinia/stores/alert`）本来就是共用的，
 * 但「发通知」这件事原先**内联在市场监控页里**：自己去读 `notifyEnabled`、
 * 自己做每条规则的冷却去重、自己拼文案。
 * 于是任何第二个用提醒的页面都得把这段再抄一遍 —— 抄错冷却时间、或漏掉去重，
 * 都会变成「页面开着一直弹」。炒货页接入时就是这么差点发生的。
 *
 * ## 冷却去重
 *
 * 按「规则 + 物品 + 档位」去重，间隔取**该规则自己的** `cooldownMinutes`。
 * 行情每次刷新都会重算命中集合，不做这两层过滤页面开着就会不停弹。
 *
 * 去重表放在**模块级**：两个页面共用同一份，避免同一条规则从不同页面各弹一次。
 */
export interface AlertNotifyOptions {
  /** 对应 `alertStore.notifyEnabled` */
  enabled: boolean
  /** 通知标题，如「市场提醒」 */
  title: string
  /** 单条命中的正文（各页的指标标签不同，由调用方给） */
  bodyOf: (hit: AlertHit) => string
  /** 多条命中时的正文，参数是条数 */
  bodyOfMany: (count: number) => string
  /** 取某条规则的冷却分钟数（规则可能被删，所以要兜底） */
  cooldownMinutesOf: (ruleId: string) => number
}

const notifiedAtMap = new Map<string, number>()

/** 只对「新出现的命中」发通知，并按每条规则的冷却时间去重 */
export function pushAlertNotifications(hits: AlertHit[], opts: AlertNotifyOptions): void {
  if (!opts.enabled || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return
  }
  const now = Date.now()
  const fresh: AlertHit[] = []
  for (const hit of hits) {
    const key = `${hit.ruleId}|${hit.hrid}|${hit.level}`
    const cooldownMinutes = Math.max(0, opts.cooldownMinutesOf(hit.ruleId))
    if (now - (notifiedAtMap.get(key) ?? 0) < cooldownMinutes * 60_000) {
      continue
    }
    notifiedAtMap.set(key, now)
    fresh.push(hit)
  }
  if (!fresh.length) {
    return
  }
  // 用 `void` 承接结果：Notification 的返回值无用，但直接 `new Notification(...)`
  // 作为表达式语句会被 no-new 判为「为副作用而 new」。
  if (fresh.length === 1) {
    void new Notification(opts.title, { body: opts.bodyOf(fresh[0]) })
    return
  }
  void new Notification(opts.title, { body: opts.bodyOfMany(fresh.length) })
}

/** 仅供测试：清空去重表 */
export function resetAlertNotifyState(): void {
  notifiedAtMap.clear()
}