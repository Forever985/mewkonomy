#!/usr/bin/env node
/**
 * 把构建产物发布到 gh-pages，并**保护线上由 GitHub Actions 维护的 data/ 目录**。
 *
 * 为什么不用 `npx gh-pages -d dist`：
 *   该命令默认 CLEAN=true，会先清空整条 gh-pages 分支再上传 dist。
 *   而 dist/data/ 只是仓库里 public/data/ 的静态副本 —— 其中 market_history.json
 *   由 market-history.yml 每 20 分钟追加采样点。于是每次本地部署都会把线上辛苦
 *   采样的历史覆盖回旧快照（实测 a4192aa 把 2 个采样点覆盖回 1 个）。
 *
 *   仓库自带的 .github/workflows/deploy.yml 早就规避了这一点：
 *       rm -rf dist/data   +   CLEAN: false
 *   本脚本把同样的语义用一个确定、可审计的方式实现：只同步「非 data」文件，
 *   data/ 原样保留。
 *
 * 用法：
 *   node scripts/publish-gh-pages.mjs --dir dist --repo https://github.com/x/y.git [--branch gh-pages]
 *   DRY_RUN=1 ... 只做演练，不推送
 *
 * 安全护栏：推送前断言 git status 中**不存在任何以 D 开头的 data/ 条目**，
 * 一旦出现删除立即中止，绝不让线上历史被误删。
 */
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)
const argOf = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const DIST_DIR = path.resolve(argOf("dir", "dist"))
const REPO = argOf("repo")
const BRANCH = argOf("branch", "gh-pages")
const DRY_RUN = process.env.DRY_RUN === "1"

/** 线上由 Actions 维护、本地部署绝不能动的目录（相对仓库根） */
const PROTECTED = ["data"]

function log(msg) {
  console.log(`  ${msg}`)
}
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} 退出码 ${r.status}`)
  return r
}
function runCapture(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: "utf8", ...opts })
}

function main() {
  if (!fs.existsSync(DIST_DIR)) throw new Error(`构建目录不存在：${DIST_DIR}`)
  if (!REPO) throw new Error("必须提供 --repo")
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error(`${DIST_DIR} 里没有 index.html，可能不是构建产物目录`)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mwk-publish-"))
  const work = path.join(tmp, "gh-pages")
  log(`临时目录：${tmp}`)

  try {
    log(`clone ${BRANCH} ...`)
    run("git", ["clone", "--branch", BRANCH, "--single-branch", REPO, work])

    // 记录受保护目录的原始状态，用于事后校验
    const protectedBefore = new Map()
    for (const p of PROTECTED) {
      const abs = path.join(work, p)
      if (fs.existsSync(abs)) {
        for (const f of fs.readdirSync(abs)) {
          protectedBefore.set(`${p}/${f}`, fs.statSync(path.join(abs, f)).size)
        }
      }
    }
    log(`线上 ${PROTECTED.join(", ")}/ 现有 ${protectedBefore.size} 个文件（将原样保留）`)

    // 1) 清掉除受保护目录以外的所有内容，保证不会残留旧 hash 资源
    for (const entry of fs.readdirSync(work)) {
      if (entry === ".git") continue
      if (PROTECTED.includes(entry)) continue
      fs.rmSync(path.join(work, entry), { recursive: true, force: true })
    }

    // 2) 从 dist 拷贝，同样跳过受保护目录
    let copied = 0
    const stack = [[DIST_DIR, work]]
    while (stack.length) {
      const [src, dst] = stack.pop()
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (src === DIST_DIR && PROTECTED.includes(entry.name)) {
          log(`跳过 ${entry.name}/（由 Actions 维护，不参与本地部署）`)
          continue
        }
        const s = path.join(src, entry.name)
        const d = path.join(dst, entry.name)
        if (entry.isDirectory()) {
          fs.mkdirSync(d, { recursive: true })
          stack.push([s, d])
        } else {
          fs.copyFileSync(s, d)
          copied++
        }
      }
    }
    log(`已同步 ${copied} 个文件`)

    // .nojekyll：确保下划线开头的资源不会被 Jekyll 忽略
    fs.writeFileSync(path.join(work, ".nojekyll"), "")

    // 3) 护栏：校验受保护目录没被动过
    for (const [rel, size] of protectedBefore) {
      const abs = path.join(work, rel)
      if (!fs.existsSync(abs)) {
        throw new Error(`[中止] 受保护文件消失：${rel} —— 绝不允许本地部署删除线上数据`)
      }
      if (fs.statSync(abs).size !== size) {
        throw new Error(`[中止] 受保护文件被改动：${rel}`)
      }
    }

    const status = runCapture("git", ["status", "--porcelain"], { cwd: work })
    const deletions = status
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("D") && PROTECTED.some((p) => l.includes(` ${p}/`) || l.includes(`\t${p}/`)))
    if (deletions.length) {
      throw new Error(`[中止] 检测到对受保护目录的删除：\n${deletions.join("\n")}`)
    }

    if (!status.trim()) {
      log("线上与构建产物一致，无需发布")
      return
    }

    const changed = status.split("\n").filter(Boolean).length
    log(`本次变更 ${changed} 项`)
    if (protectedBefore.size) {
      log(`data/ 下 ${protectedBefore.size} 个文件未出现在变更列表中（已保留）`)
    }

    if (DRY_RUN) {
      log("[DRY_RUN] 跳过推送")
      return
    }

    run("git", ["config", "user.name", "Forever985"], { cwd: work })
    run("git", ["config", "user.email", "184053786@qq.com"], { cwd: work })
    run("git", ["add", "-A"], { cwd: work })

    // add -A 之后再次确认暂存区没有 data/ 的删除
    const staged = runCapture("git", ["diff", "--cached", "--name-status"], { cwd: work })
    const stagedDel = staged
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("D") && PROTECTED.some((p) => l.includes(`\t${p}/`)))
    if (stagedDel.length) {
      throw new Error(`[中止] 暂存区包含受保护目录的删除：\n${stagedDel.join("\n")}`)
    }

    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19)
    run("git", ["commit", "-m", `deploy: ${stamp}`], { cwd: work })
    log("推送 ...")
    run("git", ["push", "origin", BRANCH], { cwd: work })
    log("发布完成")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

try {
  main()
} catch (e) {
  console.error(`\n[x] ${e.message}`)
  process.exit(1)
}
