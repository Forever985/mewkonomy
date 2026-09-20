/**
 * 本地 HTTPS CONNECT 反向代理（专供 git push / gh-pages 走加速通道）
 *
 * 解决的问题：
 *   本机用 Watt Toolkit(Steam++) 的「hosts 劫持 + 443 MITM」模式加速 GitHub，
 *   hosts 里把 github.com / codeload.github.com 等指向 127.0.0.1:443。
 *   但 **Git for Windows 的 libcurl 不读 hosts 文件**（实测：curl.exe 不读，
 *   git 直连真实 IP 20.205.243.166 超时），而把 git 直接指向 127.0.0.1:443 当代理时，
 *   Watt 对 CONNECT 请求返回 302（它只处理被劫持的直连流量，不做隧道）。
 *
 * 本代理的做法：
 *   监听 127.0.0.1:<port>，接收 git 发来的 `CONNECT host:443`，
 *   回 200 建立隧道，然后把**原始 TLS 字节流**转发到：
 *     - 目标主机在劫持名单里（github.com 等）→ 连 127.0.0.1:443（交给 Watt 做 MITM）
 *     - 其它主机                              → 按系统 DNS 解析后直连
 *   最后在隧道里完成 TLS 握手。
 *
 * 于是 git 只需认识一个普通 HTTP 代理即可，DNS 解析完全交给本进程（Node 会读 hosts）。
 *
 * 用法：node scripts/local-github-proxy.mjs [port]
 *   默认端口 7899；启动后会打印 READY 行，脚本据此判断可以开始推送。
 */
import http from "node:http"
import net from "node:net"
import tls from "node:tls"

const PORT = Number(process.argv[2] || 7899)

/** hosts 被劫持到 127.0.0.1 的域名：隧道终点固定走 Watt 的 443 */
const HIJACKED = [
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "github.io",
  "pages.github.com",
  "raw.githubusercontent.com",
  "githubusercontent.com",
  "githubassets.com",
  "objects.githubusercontent.com"
]

function isHijacked(host) {
  return HIJACKED.some(h => host === h || host.endsWith(`.${h}`))
}

/**
 * 把客户端 socket 与目标 socket 对接；TLS 由客户端发起（隧道内），
 * 因此这里必须先建立到目标的**明文 TCP**（Watt 在 443 上期待客户端发起 TLS）。
 */
function tunnel(clientSocket, head, host, port) {
  const targetHost = isHijacked(host) ? "127.0.0.1" : host
  const targetPort = isHijacked(host) ? 443 : port

  const target = net.connect({ host: targetHost, port: targetPort })
  target.setNoDelay(true)
  clientSocket.setNoDelay(true)

  target.on("connect", () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (head && head.length) {
      target.write(head)
    }
    target.pipe(clientSocket)
    clientSocket.pipe(target)
  })

  const cleanup = () => {
    target.destroy()
    clientSocket.destroy()
  }
  target.on("error", cleanup)
  clientSocket.on("error", cleanup)
  target.on("close", cleanup)
  clientSocket.on("close", cleanup)
}

/** 普通 HTTP 转发（git 有时会用 http:// 探测；gh-pages 也可能走明文） */
function forwardHttp(req, res) {
  const host = (req.headers.host || "").split(":")[0]
  const targetHost = isHijacked(host) ? "127.0.0.1" : host

  const proxyReq = http.request(
    { host: targetHost, port: 80, method: req.method, path: req.url, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )
  proxyReq.on("error", () => {
    res.writeHead(502)
    res.end("proxy error")
  })
  req.pipe(proxyReq)
}

const server = http.createServer(forwardHttp)

server.on("connect", (req, clientSocket, head) => {
  const [host, portStr] = (req.url || "").split(":")
  const port = Number(portStr || 443)
  if (!host) {
    clientSocket.destroy()
    return
  }
  tunnel(clientSocket, head, host, port)
})

server.listen(PORT, "127.0.0.1", () => {
  // 这行会被 .bat 用来判断「代理已就绪」
  console.log(`READY http://127.0.0.1:${PORT}`)
})

server.on("error", (e) => {
  console.error(`LISTEN_FAIL ${e.code || e.message}`)
  process.exit(1)
})

// 自检：启动后立刻验证隧道能否真的把 github.com 打通（避免 bat 在坏通道上空推）
if (process.env.PROXY_SELFTEST !== "0") {
  setTimeout(() => {
    const probe = tls.connect({ host: "127.0.0.1", port: 443, servername: "github.com", rejectUnauthorized: false }, () => {
      console.log("SELFTEST_OK github.com reachable via accelerator")
      probe.destroy()
    })
    probe.on("error", (e) => {
      console.log(`SELFTEST_FAIL ${e.message}`)
    })
  }, 50)
}
