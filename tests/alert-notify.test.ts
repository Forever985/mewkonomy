import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { AlertHit } from "@/common/apis/marketvolume/alerts"

/**
 * 提醒浏览器通知的共用实现（市场监控与炒货共用）。
 *
 * 重点测**冷却去重**：行情每次刷新都会重算命中集合，
 * 不去重的话页面开着就会一直弹 —— 这是这段逻辑最容易出错的地方。
 */
describe("提醒通知：权限 / 冷却去重 / 文案", () => {
  const sent: { title: string, body?: string }[] = []
  const original = (globalThis as any).Notification

  beforeEach(() => {
    sent.length = 0
    ;(globalThis as any).Notification = class {
      static permission = "granted"
      constructor(title: string, opts?: { body?: string }) {
        sent.push({ title, body: opts?.body })
      }
    }
  })

  afterEach(() => {
    ;(globalThis as any).Notification = original
  })

  const hit = (over: Partial<AlertHit> = {}): AlertHit => ({
    ruleId: "r1",
    priority: 100,
    hrid: "/items/swamp_essence",
    level: "0",
    name: "Swamp Essence",
    metric: "netRate",
    operator: "gte",
    value: 0.08,
    threshold: 0.05,
    judge: "absolute",
    ...over
  })

  const opts = (over: Partial<Parameters<typeof import("@/common/utils/alert-notify").pushAlertNotifications>[1]> = {}) => ({
    enabled: true,
    title: "价差提醒",
    bodyOf: (h: AlertHit) => `单条 ${h.name}`,
    bodyOfMany: (n: number) => `${n} 条`,
    cooldownMinutesOf: () => 30,
    ...over
  })

  it("① 关闭开关 / 未授权 ⇒ 一条都不发", async () => {
    const { pushAlertNotifications, resetAlertNotifyState } = await import("@/common/utils/alert-notify")
    resetAlertNotifyState()

    pushAlertNotifications([hit()], opts({ enabled: false }))
    expect(sent.length, "开关关闭时不得发").toBe(0)

    ;(globalThis as any).Notification.permission = "denied"
    pushAlertNotifications([hit()], opts())
    expect(sent.length, "未授权时不得发").toBe(0)
  })

  it("② 单条 ⇒ 用 bodyOf；多条 ⇒ 用 bodyOfMany", async () => {
    const { pushAlertNotifications, resetAlertNotifyState } = await import("@/common/utils/alert-notify")
    resetAlertNotifyState()

    pushAlertNotifications([hit()], opts())
    expect(sent.length).toBe(1)
    expect(sent[0].title).toBe("价差提醒")
    expect(sent[0].body).toBe("单条 Swamp Essence")

    resetAlertNotifyState()
    sent.length = 0
    pushAlertNotifications([hit({ ruleId: "r2" }), hit({ ruleId: "r3" })], opts())
    expect(sent.length).toBe(1)
    expect(sent[0].body).toBe("2 条")
  })

  it("③ 冷却期内同一条规则+物品不重复发", async () => {
    const { pushAlertNotifications, resetAlertNotifyState } = await import("@/common/utils/alert-notify")
    resetAlertNotifyState()

    pushAlertNotifications([hit()], opts({ cooldownMinutesOf: () => 30 }))
    expect(sent.length, "首次应发").toBe(1)

    // 同一 (规则, 物品, 档位) 再来一次 ⇒ 被冷却挡住
    pushAlertNotifications([hit({ value: 0.09 })], opts({ cooldownMinutesOf: () => 30 }))
    expect(sent.length, "冷却期内不重复发").toBe(1)

    // 冷却 0 ⇒ 立刻可以再发
    pushAlertNotifications([hit({ value: 0.1 })], opts({ cooldownMinutesOf: () => 0 }))
    expect(sent.length, "冷却 0 时允许再发").toBe(2)

    // 不同规则 ⇒ 独立计数
    resetAlertNotifyState()
    sent.length = 0
    pushAlertNotifications([hit({ ruleId: "r1" })], opts())
    pushAlertNotifications([hit({ ruleId: "r9" })], opts())
    expect(sent.length, "不同规则各发一次").toBe(2)
  })

  it("④ 空命中不发", async () => {
    const { pushAlertNotifications, resetAlertNotifyState } = await import("@/common/utils/alert-notify")
    resetAlertNotifyState()
    pushAlertNotifications([], opts())
    expect(sent.length).toBe(0)
  })
})