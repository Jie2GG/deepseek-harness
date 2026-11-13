# Agent Note: 失效的启动令牌给出登录页

Status: implemented

[English](2026-11-13-stale-launch-token-signin-page.md) | 中文

## 问题

`BrowserAuth.authorizeIndex` 对任何带 `token` 查询参数但不被交换的 index 请求，都用 `writeUnauthorized` 返回纯文本 401，而 [Connection README](../../../../packages/client/connection/README.zh.md) 与 [frontend-static README](../../../../packages/host/frontend-static/README.zh.md) 都承诺其余每个未认证的 index 请求得到 `200` 的登录或设置页文档。每次 `dsh web` 启动都在仅进程内的 `WeakMap` 里铸造新的进程令牌，于是仍带着上一次令牌的书签、浏览记录和 supervisor 链接在重启后一律落到那个 401：浏览器显示一个没有表单的错误页，账号密码登录在读者手工删掉查询串之前无法到达。

## 决策

终结 token 分支的那次拒绝改调 `writeSignInPage`，因此过期、重复或不在根路径的 token 查询现在与完全不带凭据的请求落到同一个页面。两个回答保持不变：有效的根路径 token 仍铸造绑定 authority 的 cookie 并重定向到 `./`；已登录浏览器在根路径带 token 时仍重定向到 `./`，不再重新交换。`GET /connect?token=...` 保留 401，因为它是 API 操作者交换而非浏览器入口；`/api` 与 Gateway 流升级也保留各自的 401。

## 曾考虑的替代方案

**只在请求要求 `text/html` 时渲染该页。** 内容协商让同一个未解决凭据得到两种回答，并把浏览器路径从只看状态行的人面前藏起来；而 index 路由在任何情况下都服务浏览器入口。

**把过期 token 重定向到 `./`，而不是用页面回答。** 多一跳丢掉了到达的那个请求，而且 cookie 已证明浏览器登录着的情形早已被重定向覆盖。

**为机器探测保留 401。** 探测入口属于 `/api` 与 `/connect`，它们保留各自状态码；index 探测从 401 里得到的信息不比页面已经显示的更多。

## 后果

被收藏的启动链接在重启后仍然是通往表单的路径，运维者不必再删查询串才能登录。index 的 `HEAD` 以 200 与文档响应头回答；Node 对该方法抑制响应体，而 `dsh web authentication required` 文案此后只出现在 `/connect`。cookie 格式、会话数据以及其他路由已发布的状态码承诺都没变。

## 测试

`packages/client/connection/tests/browser-auth.host.spec.ts` 用设置页文档回答四个带 token 的 index 请求——错误 token、两个 `token` 参数、配置 index 路径上的 token、启动 URL 上的 `HEAD`——并区分已登录的根路径请求（重定向到 `./`）与配置 index 路径上的访客请求（收到登录表单）。`packages/host/frontend-static/tests/frontend-static.spec.ts` 仍在真实 HTTP 下为不带凭据的 index 读取提供登录页，`API credentials` 用例仍断言 `/connect` 的 401。
