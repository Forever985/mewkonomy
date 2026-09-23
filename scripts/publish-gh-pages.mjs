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
/**
 * 旧构建产物（hash 资源）的保留时长（秒）。
 *
 * 为什么要留：GitHub Pages 的 `index.html` 有约 10 分钟的 CDN 缓存，而本项目用的是
 * hash 文件名（assets/index-XXXX.js）。若部署时立刻把上一版的资源删掉，这段时间里
 * 缓存中的 index.html 仍指向旧 hash → 用户看到 404 / 白屏。
 * 实测踩过两次，所以旧产物保留 24 小时再清理（远大于缓存时间，又不会无限堆积）。
 */
const KEEP_OLD_SECONDS = 24 * 3600

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

/** dist 里所有文件的相对路径集合（用于判断线上哪些文件本次不再产出） */
function collectDistFiles(distDir) {
  const files = new Set()
  const stack = [distDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (dir === distDir && PROTECTED.includes(entry.name)) continue
        stack.push(abs)
      } else {
        files.add(path.relative(distDir, abs).split(path.sep).join("/"))
      }
    }
  }
  return files
}

/**
 * 删除线上「本次不再产出」的文件，但**保留最近 KEEP_OLD_SECONDS 内提交过的**。
 *
 * 旧产物不能立刻删：见 KEEP_OLD_SECONDS 的说明（index.html 的 CDN 缓存期）。
 * 不整目录 rm 还有第二个好处：删除是逐个文件显式进行的，不会误伤 data/。
 */
function pruneStaleFiles(work, distFiles) {
  const tracked = runCapture("git", ["ls-files"], { cwd: work })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const nowSec = Date.now() / 1000
  const removed = []
  const kept = []
  for (const rel of tracked) {
    if (PROTECTED.some((p) => rel === p || rel.startsWith(`${p}/`))) continue
    if (distFiles.has(rel)) continue
    const stamp = Number(
      runCapture("git", ["log", "-1", "--format=%ct", "--", rel], { cwd: work }).trim() || 0
    )
    if (stamp && nowSec - stamp < KEEP_OLD_SECONDS) {
      kept.push(rel)
      continue
    }
    fs.rmSync(path.join(work, rel), { force: true })
    removed.push(rel)
  }
  if (kept.length) {
    log(`保留 ${kept.length} 个 24 小时内的旧产物（避免 CDN 缓存的 index.html 指向已删除的 hash 资源）`)
  }
  return { removed, kept }
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

    // 1) 删掉本次不再产出、且已过保留期的旧文件。
    //    不用「整目录 rm」：那样会把上一版的 hash 资源立刻删掉，而 CDN 里的
    //    index.html 还有约 10 分钟缓存，会导致白屏/404（实测踩过两次）。
    const distFiles = collectDistFiles(DIST_DIR)
    const { removed, kept } = pruneStaleFiles(work, distFiles)
    log(`清理过期产物 ${removed.length} 个${kept.length ? `，保留 ${kept.length} 个新近产物` : ""}`)

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

    // 必须在 add 之后再看一次「是否真的有待提交内容」。
    // 上面的 status 是 add 之前的：Windows 上 core.autocrlf 会让 checkou 出来的文本
    // 与 dist 的 LF 版本逐行不同，于是 status 报一堆「已修改」，
    // 而 add 规范化后其实与 HEAD 完全一致 —— 此时 commit 会以
    // "nothing to commit" 退出码 1 失败，把一次「本来就无需发布」误报成部署失败。
    if (!staged.trim()) {
      log("线上与构建产物一致（差异仅为行尾规范化），无需发布")
      return
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
