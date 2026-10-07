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
import { spawnSync } from "node:child_process"
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

/**
 * 浅克隆（只取最新一个提交）。
 *
 * 为什么必须浅克隆：gh-pages 分支积累了 300+ 个 `chore(data)` 提交（Actions 每
 * 20 分钟追加市场采样点），全量 clone 在本机链路上传不完。
 * 实测（2026-10-07）：全量 clone 反复以
 *   `fetch-pack: invalid index-pack output`
 *   `unexpected disconnect while reading sideband packet`
 * 失败；`--depth 1` 后 39MB、约 30 秒完成。
 *
 * 代价：拿不到文件历史 ⇒ 无法判断旧产物是否过期 ⇒ 跳过清理（见 pruneStaleFiles）。
 */
const SHALLOW = true

// ── 代理自动探测 ─────────────────────────────────────────────────────
//
// ## 为什么脚本要自己找代理
//
// 本机 Watt Toolkit(Steam++) 有两种模式，端口完全不同：
//   · hosts 劫持 + 443 MITM → 需本地 CONNECT 中继 127.0.0.1:7899
//   · 系统代理模式          → 直接开普通 HTTP 代理（实测 127.0.0.1:10808）
//
// 而环境变量里的 `HTTP_PROXY` 可能指向一个「**在监听但不响应**」的死端口
// （实测本机是 127.0.0.1:9044）。git **在没有显式 proxy 配置时会读环境变量**，
// 于是被它带进沟里：clone 不是超时就是 "invalid index-pack output"。
//
// ⇒ 这里一律**实测**候选端口，选出真的能连的那个，并显式写进 git 参数。
// 这样无论用户双击哪个 bat（有没有经过 detect 过代理的 ps1），都能工作。
const PROXY_CANDIDATES = [10808, 7890, 7897, 1080, 10809, 7899, 9044]

/**
 * 传给 git 的公共参数：代理 + 传输加固。
 *
 * 最后三条是把 clone 从「必失败」救回来的关键。实测同一仓库、同一网络：
 *   · 默认（HTTP/2）        → `unexpected disconnect while reading sideband packet`
 *   · HTTP/1.1 + 大缓冲 + 关压缩 → 成功
 * 原因是本机链路上 HTTP/2 多路复用会被中断，退回 HTTP/1.1 即稳定。
 */
function gitFlags(port) {
  return [
    "-c", `http.proxy=http://127.0.0.1:${port}`,
    "-c", `https.proxy=http://127.0.0.1:${port}`,
    "-c", "http.sslVerify=false",
    "-c", "http.version=HTTP/1.1",
    "-c", "http.postBuffer=524288000",
    "-c", "core.compression=0"
  ]
}

/** 逐个实测候选端口，返回第一个 git 真能连通的；全不行返回 0 */
function detectProxyPort() {
  for (const port of PROXY_CANDIDATES) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      // timeout 防止死端口把探测挂死（9044 就是「连得上但不响应」）
      const r = spawnSync(
        "git",
        [...gitFlags(port), "ls-remote", "--heads", REPO, BRANCH],
        { stdio: "ignore", timeout: 25000 }
      )
      if (!r.error && r.status === 0) {
        return port
      }
      // spawn 本身偶发 EBUSY ⇒ 重试同一端口；真的连不通（有 status）才换下一个
      if (r.error && isSpawnBusy(r.error) && attempt < 3) {
        sleepSync(200 * attempt)
        continue
      }
      break
    }
  }
  return 0
}

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
/** 同步等待（毫秒）。Atomics.wait 是纯同步的，不需要把整个脚本改成 async。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Windows 上 spawn 偶发 EBUSY 时是否该重试。
 *
 * 实测（2026-10-07）：同一条 `git --version` 连续调用会出现
 * status=0 / ERR EBUSY 交替，且与 stdio 模式无关（ignore/inherit 正常，
 * encoding=utf8 失败，但同样的 encoding=utf8 配上显式 stdio 又成功）。
 * ⇒ 这是**间歇性的句柄/文件占用**（杀软扫描新写入的 clone 目录、
 *    或进程创建钩子），不是确定性故障。
 *
 * 它曾经真实地让发布流程中断在 `git ls-files` 上：
 *   [x] spawnSync git EBUSY
 * 所以必须重试，不能当致命错误直接抛出。
 */
function isSpawnBusy(e) {
  const code = e && e.code
  return code === "EBUSY" || code === "EAGAIN" || /EBUSY|EAGAIN/.test(String(e && e.message))
}

const SPAWN_ATTEMPTS = 6

function run(cmd, cmdArgs, opts = {}) {
  let lastErr
  for (let i = 1; i <= SPAWN_ATTEMPTS; i++) {
    const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...opts })
    if (!r.error && r.status === 0) return r
    const err = r.error || new Error(`${cmd} ${cmdArgs.join(" ")} 退出码 ${r.status}`)
    // 只对「进程根本没起来」重试；进程起来了但退出码非 0 是真实错误，立即抛出
    if (!r.error || !isSpawnBusy(r.error)) throw err
    lastErr = err
    if (i < SPAWN_ATTEMPTS) sleepSync(150 * i)
  }
  throw lastErr
}

/**
 * 捕获命令行输出（同步）。
 *
 * ★ 用**文件描述符重定向**，不用管道。
 *
 * 为什么：实测（2026-10-07）在 clone 出来的目录里，
 * `spawnSync(git, [...], { encoding: "utf8" })`（走管道）**必失败**：
 *     ERR EBUSY: spawnSync git EBUSY
 * 连续重试 6 次全部 EBUSY，而把 stdout 指向一个普通文件则稳定成功
 * （同一目录、同一命令、连测 4 次全 OK）。stderr 指向 ignore 也一样正常。
 *
 * 这曾让整个发布中断在 `git ls-files` 上（`[x] spawnSync git EBUSY`），
 * 是本轮「部署报成功但网站没变化」的直接原因之一。
 *
 * 顺带保留对 EBUSY 的少量重试：进程创建偶发占用（杀软扫描新 clone 的目录）
 * 在别的机器上仍可能出现，重试成本极低。
 */
function runCapture(cmd, cmdArgs, opts = {}) {
  const { cwd } = opts
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const outFile = path.join(os.tmpdir(), `mwk-capture-out-${stamp}.txt`)
  const errFile = path.join(os.tmpdir(), `mwk-capture-err-${stamp}.txt`)

  let lastErr
  for (let i = 1; i <= SPAWN_ATTEMPTS; i++) {
    let fdOut, fdErr
    try {
      fdOut = fs.openSync(outFile, "w")
      fdErr = fs.openSync(errFile, "w")
      const r = spawnSync(cmd, cmdArgs, { cwd, stdio: ["ignore", fdOut, fdErr] })
      fs.closeSync(fdOut); fdOut = undefined
      fs.closeSync(fdErr); fdErr = undefined

      if (r.error) throw r.error
      if (r.status !== 0) {
        const detail = fs.readFileSync(errFile, "utf8").trim()
        throw new Error(`${cmd} ${cmdArgs.join(" ")} 退出码 ${r.status}${detail ? `\n${detail}` : ""}`)
      }
      return fs.readFileSync(outFile, "utf8")
    } catch (e) {
      if (!isSpawnBusy(e)) throw e
      lastErr = e
      if (i < SPAWN_ATTEMPTS) sleepSync(150 * i)
    } finally {
      if (fdOut !== undefined) { try { fs.closeSync(fdOut) } catch {} }
      if (fdErr !== undefined) { try { fs.closeSync(fdErr) } catch {} }
      try { fs.unlinkSync(outFile) } catch {}
      try { fs.unlinkSync(errFile) } catch {}
    }
  }
  throw lastErr
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
  /**
   * 浅克隆时**不做清理**。
   *
   * 判断「旧产物是否过期」依赖 `git log -1 --format=%ct -- <file>` 读文件历史，
   * 而浅克隆只有 1 个提交，所有文件都会拿到同一个（很新的）时间戳 ⇒ 判断失准。
   *
   * 宁可不清理也不能删错：线上 `index.html` 有约 10 分钟 CDN 缓存，
   * 若删掉它仍在引用的旧 hash 资源，用户会看到白屏（本仓库实测踩过两次）。
   * 代价只是旧产物缓慢堆积，远优于白屏。
   */
  if (SHALLOW) {
    const tracked = runCapture("git", ["ls-files"], { cwd: work }).split("\n").filter(Boolean)
    log(`浅克隆：跳过旧产物清理（保留线上现有 ${tracked.length} 个文件）`)
    return { removed: [], kept: tracked }
  }

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
    const port = detectProxyPort()
    if (!port) {
      throw new Error(
        "找不到可用的 GitHub 加速通道（候选端口全部连不通）：\n" +
        "    请确认 Watt Toolkit 已开启，且「网络加速 - GitHub」已勾选。\n" +
        "    候选端口：" + PROXY_CANDIDATES.join(", ")
      )
    }
    log(`使用代理 127.0.0.1:${port}`)

    log(`clone ${BRANCH}${SHALLOW ? "（浅克隆）" : ""} ...`)
    run("git", [
      ...gitFlags(port),
      "clone", "--branch", BRANCH, "--single-branch",
      ...(SHALLOW ? ["--depth", "1"] : []),
      REPO, work
    ])

    // 把代理固化进**这个临时仓库**的配置，
    // 这样后面的 add / commit / push 不必再逐条带 -c 参数。
    // 只写 work/.git/config，不动用户的任何全局配置。
    run("git", ["config", "http.proxy", `http://127.0.0.1:${port}`], { cwd: work })
    run("git", ["config", "https.proxy", `http://127.0.0.1:${port}`], { cwd: work })
    run("git", ["config", "http.sslVerify", "false"], { cwd: work })
    run("git", ["config", "http.version", "HTTP/1.1"], { cwd: work })
    run("git", ["config", "http.postBuffer", "524288000"], { cwd: work })

    // ── 关掉行尾转换（只在这一次发布的临时仓库里生效）────────────────────
    //
    // 为什么需要：本机 `core.autocrlf=true`（Git for Windows 安装时的系统级默认），
    // 而 gh-pages 上全是 `assets/*.js|css`、`index.html` 这类**构建产物**。
    // autocrlf 会对它们做「LF ↔ CRLF」双向转换，于是 `git add -A` 时逐个报
    // `warning: LF will be replaced by CRLF` —— 一次发布刷出近百行。
    //
    // 为什么可以直接关：
    // - 构建产物是**精确字节**（文件名带内容 hash、行尾参与不影响语义但改了 hash 会对不上），
    //   行尾转换对它只有坏处没有好处；
    // - 用 `git -c` **只作用于本仓库**（`work/.git/config`），不动用户的全局配置；
    // - 关掉后那句"差异仅为行尾规范化"的兜底判断也不再需要走（内容本来就该一致）。
    //
    // `safecrlf=false` 是配套的：它关闭「CRLF 与 LF 混用时报错」的检查，
    // 只影响提示，不影响内容。
    run("git", ["config", "core.autocrlf", "false"], { cwd: work })
    run("git", ["config", "core.safecrlf", "false"], { cwd: work })

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
    //
    // 原因：上面的 status 是 add **之前**的快照。文本文件在 Windows 上可能因行尾
    // 规范化而看起来「已修改」，add 之后才归一，若与 HEAD 实际一致，
    // commit 会以 "nothing to commit" 退出码 1 失败，把一次「本来就无需发布」
    // 误报成部署失败。
    //
    // ⚠️ 本仓库已在 clone 之后关掉 `core.autocrlf`（见上文），构建产物不再被转换，
    // 所以这条兜底**现在是双保险**——正常情况下根本不会走到「有差异又被 add 抹平」这条路。
    if (!staged.trim()) {
      log("线上与构建产物一致，无需发布")
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
