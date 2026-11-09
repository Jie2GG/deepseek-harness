---
description: "Web GUI 的浏览器与 Host 之间的协议层：Remote RPC、带重连的事件流投递、精确 Fetch 路由、/api HTTP 桥与浏览器信任栅栏。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-connection

[English](README.md) | 中文

## 概述

本包承载浏览器到 Host 的 Remote 调用、精确 Fetch 响应与 connection generation。Client 插件挂载 `ctx.connection`，其中包含当前页面的 loopback 状态、通用 RPC、当前 generation 及其 Host 信息、可观察的恢复状态、立即重连命令、服务页面携带的退出登录命令，以及单一 generation source 的注册点。source 报告 ready 后 generation 才可见；source 结束、失败、被撤回或显式 stop 都会清空它，再由 `ConnectionController` 执行重试策略。

## 目录

- [使用本包](#use-this-package)
- [浏览器认证与请求信任](#browser-authentication-and-request-trust)
- [Connection generation](#connection-generation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`./client` 导入在 Node 中选择独立的 `lib/client.node.js` ESM bundle，在浏览器中选择 `lib/client.browser.js` loader factory。Web Host 仍以逻辑 URL `/plugins/.../client.js` 提供浏览器导出。非页面 Cordis 树应导入 Client 入口；独立的包根入口是 Host 入口。

静态桌面页面可以通过 `__DSH_TRANSPORT__.streamBaseUrl` 提供其所拥有 Host 的 HTTP origin。Gateway 将该 origin 用于 WebSocket，HTTP 传输仍独立选择。桌面载体负责认证；仅设置 origin 不会授予访问权限。

一元 RPC 请求使用 JSON。Host handler 可以返回已经从 JSON 兼容结果值中分离的字节附件，每个附件标明其相对于结果的路径。Connection 将这些值写为 multipart 部分。JSON `metadata` 部分包含带 `null` 占位值的 RPC 响应信封，以及记录各路径、codec 和部分标识符的附件表。路径使用字符串键与数字数组下标，不保留任何业务字段名。Client 校验信封、`rpcId`、附件表和各部分，再将每个字节值恢复为以 `ArrayBuffer` 为底层缓冲区的视图。没有附件的结果（包括 base64 字符串）与失败仍使用 JSON。逻辑 RPC 载体直接返回解码后的原生值。Connection 不识别二进制字段，也不依赖 Typert；拥有结果协议的 handler 在返回前执行按类型或按运行时值的投影。不支持二进制参数、事件和二进制流式结果。

浏览器通过 HTTP POST 执行 Remote 一元调用；API Gateway 自己拥有 `/api/remote.mux` WebSocket 及其逻辑流。由 shell 持有的组合通过 `connection.rpc.open` 提供等价的 Remote 流（包括流的上行），不打开 WebSocket。浏览器插件读取页面 transport、恢复设置与 location，再委托 `installConnection(ctx, options)`。持有自身载体的组合可以直接调用同一个安装函数；整机客户端测试档就是这一消费者。非页面载体通过 `ClientTransportHooks.createWebSocket` 使用与 HTTP 相同的认证 Cookie，并提供 `streamBaseUrl`；`ConnectionHandle.openWebSocket()` 根据该 base 解析 Mux 路径，再调用所选工厂。每次调用都会创建一个归所属 Context 的服务，因此同一 realm 中的多棵 Client 树可以使用不同载体。Host half 始终提供与载体无关的 RPC 注册表和精确 `GET`/`HEAD`/`POST` 路由注册表。存在 Web 载体时，它还持有唯一 `/api` route、Fetch bridge、浏览器认证与 Host/Origin 校验；由 shell 持有的载体则直接分派共享 Fetch handler。每条精确路由会在 bridge 读取任何字节前声明缓冲或流式请求体处理方式。Typert Gateway 认领生成的 Remote endpoint，功能包注册 Session 日志下载、原始文件上传等非 JSON 响应，未认领的请求返回 404。Loopback hostname 判定只供浏览器侧当前页面状态使用，留在包内。浏览器原始请求体传输由 [`dsh-client-file-upload`](../file-upload/README.zh.md) 提供。

-----

<a id="browser-authentication-and-request-trust"></a>
## 浏览器认证与请求信任

通过 Web 载体访问时，每个 Host RPC 方法和 WebSocket 流都要求经过认证的浏览器或 API Peer，不存在按方法区分的 loopback 层。浏览器用一个账号名加一个口令登录。`dsh web` 打印的网址仍带进程启动令牌，供 supervisor 与机器客户端使用；它自动打开的浏览器地址不带令牌，所以首次访问看到的是表单而不是应用。`frontend-static` 把根路径与 index 请求交给 `ctx.connection.authorizeIndex`：`GET /?token=...` 交换仍会写入绑定 authority 的签名 cookie 并重定向到干净的 `./`；其它未认证的 index 请求返回 `200` 和一个自包含的登录或设置文档（`Cache-Control: no-store`，不引用外部资源），它向下面这些路由提交 JSON。缺失、过期、畸形、authority 不符或 generation 不符的 cookie 因此落到登录页而不是应用，而 `/api` 调用仍返回 401 文本。静态资源保持公开。HTTP 载体只在根路径交换与 `/connect` 接受查询令牌，且不接受 Authorization 头令牌。

这套认证入口有六条路由，都由本插件注册在 `/connect` 旁边，且每条都先过同一道 Host/Origin 栅栏。尚未登录的浏览器可以调用 `POST /auth/setup`（在尚无口令时存下第一条口令）、`POST /auth/login`（校验账号与口令）和 `POST /auth/logout`（清除自己的 cookie）。已登录的浏览器还可以调用 `POST /auth/state`（报出账号名、是否已设口令，以及本次会话是口令登录还是令牌换入）、`POST /auth/change`（先证明当前口令，再存入新的账号名与口令）和 `POST /auth/revoke`（替换会话代次，从而登出其他所有靠口令登录的浏览器，而本机、桌面宿主与机器客户端不受影响）。每条只接受一个不超过 64 KiB 的 `application/json` 请求体，并返回 JSON：成功是 `200` 加 `Set-Cookie`；账号或口令错误、或调用方尚未登录是 `401`；改口令时当前口令证明不了是 `403`；表单与已存状态不再一致是 `409`；账号名不可用、口令过短、两次输入不一致或字段未知是 `400`；体积与类型不符分别是 `413` 与 `415`；处于登录等待期内是 `429`。拒绝响应带上本地化提示以及表单应切换到的文案，因此同一个页面承担两种形态；连续失败达到两次时，拒绝响应还会报出失败次数。首次设置借助 `ctx.credentials.modifyRecord` 避免竞态：写入时发现没有记录的那一方创建它，之后的调用方都被要求改为登录。口令长度限为 8–256 字符；提交的账号名会去除首尾空格并区分大小写比较。表单提供确认输入框与「记住我」：不勾选时省略 `Max-Age` 与 `Expires`，该 cookie 随浏览器关闭而消失，而签名内容仍按配置的上限到期。页面文案按 `Accept-Language` 在随产品发布的界面语言中选择，无法匹配时回落英文。

口令是 owner 作用域的 `client-connection/password` grant 记录：`{version, username, digest, sessionEpoch}`，其中 digest 形如 `scrypt$<cost>$<blockSize>$<parallelism>$<salt>$<key>`，参数是协议固定的（cost 16384、block size 8、parallelism 1、salt 32 字节、key 64 字节）；`sessionEpoch` 是 32 字节随机值，凡需要让所有口令登录作废时就被替换。只有该记录的所有者解读 digest，记录沿用提供方的 `0600` 权限、文件锁与原子写。版本 `1` 的记录——同样的字段但没有 `sessionEpoch`——仍然可读，并继续为它已签出的 cookie 提供同一个 generation，所以升级本版本不会把任何人踢下线；第一次改口令或替换会话时它被重写为版本 `2`。配置项 `username`（默认 `dsh`）只提供新设置表单里的账号名；记录一旦存在，表单报出的就是当时存入的名字，直到某次修改把它替换掉。忘记口令的恢复办法仍是删除该记录并重启，页面随之回到设置形态。这里没有账号列表，也没有按账号划分的权限：所有已认证浏览器仍共用 `ctx.connection.browserPeer`。

cookie 签名密钥是 `ctx.credentials` 中由 `client-connection/browser-session` 拥有的 grant 记录。本地提供方把它持久化到 `$DSH_HOME/.credentials.yaml`；`BrowserAuth` 在 Connection 激活期间加载或创建该记录，并把密钥留在内存中，因此除了一次提交口令所需的 scrypt 推导之外，请求认证仍是同步的。删除或替换该记录会在下一次 Connection 激活时生效。cookie 携带绝对签发与过期区间，`cookieMaxAgeDays` 默认设为 30 天，并在确定性名称与签名 payload 中同时绑定规范化 hostname 和 port。浏览器 cookie 是版本 `v3`，带上由当前 `client-connection/password` 记录哈希出的 generation；由进程令牌签发的则带 `launch`：改口令或调用 `/auth/revoke` 会使口令签发的 cookie 立即失效，而机器与桌面会话仍保住自己的；版本 `v1` 的浏览器 cookie 被拒绝，API cookie 仍是版本 `v2`。它是 host-only、`Path=/`、`HttpOnly`、`SameSite=Strict`；收到该 index 请求的监听器提供 TLS 时才带上 `Secure`，且只由该监听器自身的协议决定，`publicUrl` 声明与转发头都不参与判断。

重复登录会被放慢：按客户端地址与账号名统计连续失败，等待时间从一秒起倍增，上限三十秒，一旦成功即清零。这个等待只存在内存里，重启后重新计算；启动令牌与 `/connect` 不受放慢影响。 每一次登录成功或失败、首次设置、改口令、替换会话与登出都会经 `ctx.logger` 写一行，只含账号名与对端地址，任何一行都不带口令。

HTTPS cookie 名称与签名 audience 包含 `https:` scheme，因此即使 hostname 和 port 相同，HTTP cookie 也无法通过 TLS 监听器的认证。默认端口按监听器的 scheme 归一化。既有 HTTP cookie audience 保持不变。

认证之前，每个请求都经过 `src/api-request-trust.ts`。其 `Host` 必须是 loopback、等于监听器的绑定 IP 字面量（端口不限），或与 `trustedHosts` 条目匹配：带端口的 `host:port` 精确匹配，不带端口的条目匹配任意端口。Host 与配置条目按监听器的 scheme 做 WHATWG 默认端口归一化，不采信转发 header 或 `Origin`。附带的 HTTP(S) `Origin` 必须指向同一 authority；此时按 Origin 的 scheme 解析 Host，以支持 HTTPS 代理转发到 HTTP 上游；`sec-fetch-site: cross-site` 一律拒绝。畸形配置 authority 会让插件加载失败。`allowsRemoteAuthorities` 报告 `trustedHosts` 是否允许非 loopback authority；接受绑定 IP 不会改变该列表。这些检查防御 DNS rebinding 与跨站浏览器请求，绝不建立身份。Host/Origin 校验失败返回 403；Host 可信但未认证的请求返回 401。`dsh web --host 0.0.0.0` 不受支持。决策记录：[浏览器请求信任](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.zh.md)与[浏览器令牌认证](../../../.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.zh.md)。

每个请求都代表一个 Peer：`principal` 指明调用方，`interactions` 决定能否参与转发事件，`signal` 在 scope 结束时中止。`ctx.connection.browserPeer` 由通过认证的浏览器连接共享，principal 为 owner，默认 `interactions: 'answer'`。`ctx.connection.admit(request)` 检查信任与浏览器或 API 认证，返回凭据对应的存活 Peer 或拒绝状态；`/api` 路由和 Gateway WebSocket 升级都使用该结果，处理器接收本次调用的 Peer。`ctx.connection.createPeer({ principal, interactions? })` 创建独立进程内 Peer，由读取该服务的 Context 或其自身的 `dispose()` 释放；省略 interactions 时默认 `answer`。导出的 `Peer` 类接受相同参数。`fetch(request, peer)` 和 HTTP bridge 必须显式接收 Peer；对非 owner Peer，exact route 返回 403。其他 principal 的方法级访问归 [`dsh-api-remote-access`](../../api/remote-access/README.zh.md)。

仅供 API 使用的 `GET /connect?token=...&interactions=answer|none` 立即创建 principal 为 owner 的 Peer，返回 302、Mux 目标地址与签名 API Cookie。API 连接默认 `none`，非法或重复声明返回 400。HTTP 可先于 WebSocket 建立。一条 API socket 负责清理：重复关联返回 409，关闭时移除其 Peer，之后使用该 Cookie 的 HTTP 被拒绝。已受理 unary 调用保留请求级取消，但 Peer 释放后 `invocation.peer.ctx` 不再接受新的 effect 注册。API 调用方将 Cookie 与浏览器存储分开；两者使用相同的 authority 专属 Cookie 名称。

通过认证的共享 HTTP 请求在传输请求体之前经过 `connection/request` waterfall。监听器可以拒绝新请求，或等待 `next()` 直到响应完成；释放所属 fiber 会移除准入行为。Desktop 使用此扩展点，在已批准的安装期间锁住新的 API 工作，而不取消已接纳的工作。客户端断开会中止处理函数的信号；桥接器停止写入 socket，并排空剩余响应块。WebSocket 流仍由 API Gateway 负责。

<a id="connection-generation"></a>
## Connection generation

未显式指定时，`installConnection` 将页面的 `interactions` 解析为 `answer`，非页面调用方解析为 `none`。只有回答型 Client 把内部 `$events` 逻辑流注册为唯一 generation source，与有无 `$on` 订阅无关。Host 在 API Remotes source factory 同步挂好所有增量 listener 后，先发送唯一 `{ type: 'ready', clientId, host: { home } }` 项，再发送事件。`ConnectionController` 仅在收到该 ready 项后发布 generation 并调用 `onConnected`，因此 baseline 不会跑在增量 listener 前面。

`$events` 结束、Remote 流报错、收到非 ready 首项或畸形事件项，都会使当前 generation 失效。默认情况下，挂起的握手在 3 秒后记录 Host 响应缓慢告警，在 15 秒后记录就绪超时并中止，包含等待物理 socket 的时间。取消后，source 必须停止投递、释放资源并结束，替换 source 才能启动；已取消 source 迟到的 ready 不能发布 generation。浏览器报告网络可用时，Controller 发布 `connecting`，并在 500ms、1s、2s、4s、8s 与 10s 上限内采用 50%–100% 抖动重试，达到终档后继续尝试直到恢复。每次重试都要求 Gateway 替换一次物理 WebSocket，再重开 `$events`。

`ctx.connection.reconnect()` 会中断活动工作、重置序列，并立即开始 retry 1。浏览器 `offline` 会中断活动工作、发布 `disconnected` 并暂停自动尝试；下一次 `online` 转换会重置序列并从 500ms 档开始。只有 ready 项会发布 `connected`。Gateway mux 不拥有独立重试调度。

可通过 Host Connection 行的 `config.recovery` 覆盖重试上限、增长因子或握手告警与取消时间；[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-client-connection)列出接受的字段。Host 校验这些值，并将其注入所提供的每个页面。Client 在提供 Connection 前校验启动数据，并在 Gateway 启动循环时采用这些默认值；显式传给 `start()` 的时序覆盖优先。增长因子必须是至少为一的有限数。若就绪、失败、取消或硬期限先于告警发生，该告警会被取消。修改 Host 恢复配置后需重新加载页面。


<a id="model-experience"></a>
## 模型体验

无。协议消费层只在浏览器与主机之间搬运已经组合好的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **缓冲型 `/api` 路由会把每个请求体保留在内存里**：`maxRequestBodyBytes`（默认 300 MiB，按默认 200 MiB 图片总量上限经 base64 膨胀加信封余量得出）限制普通图片与 RPC 信封。显式启用的流式路由接收带背压的分块并绕过总量上限；路由实现负责持久化、取消与存储配额。
- **明文 HTTP 监听器会在传输中暴露 bearer cookie 与登录口令**：此类部署无法给浏览器 cookie 加 `Secure`；若把同一 authority 暴露到网络上，会话 cookie 可能泄露；在 Web 载体（[`dsh-host-webserver`](../../host/webserver/README.zh.md)）上配置 TLS 即可让 cookie 带上 `Secure` 并只经 TLS 发送。
- **未使用的 API Peer 可以保留到 Host 退出**：调用方从未建立 WebSocket 时，其轻量记录不受建联期限或空闲回收约束。Cookie 过期仍拒绝新请求。其生命周期 socket 关闭或 Host 重启后，API 调用方必须通过 `/connect` 重新接入。
- **一个口令守住所有浏览器会话**：没有账号列表，也没有按账号划分的权限，所以共用电脑无法区分使用者；所有已认证浏览器仍然共用 `ctx.connection.browserPeer`。
- **登录节流只在进程内，忘记口令要回到磁盘上恢复**：按地址与账号的等待保存在内存里，重启即清零；设置页里的改口令要求调用方已经知道当前口令，忘记口令的恢复办法仍是删除 `client-connection/password` 记录并重启。
- **退出只逐个覆盖浏览器**：`POST /auth/logout` 只清除该浏览器的 cookie，`POST /auth/revoke` 一次作废其他所有口令签发的 cookie，改口令同样会替换这个会话代次；令牌签发的 cookie 不在其中，会活到自身过期或进程令牌变化。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
