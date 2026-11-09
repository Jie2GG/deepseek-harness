---
description: "浏览器访问首页现在需要账号名加口令登录，浏览器 cookie 迁移到携带 generation 的 v3，Web 传输层新增三条 /auth 路由与设置页的退出动作。"
kind: upgrade-guide
---

# 浏览器改用账号名与口令登录

[English](guide.md) | 中文

## 变更

浏览器打开已发布的应用界面时，改用一个账号名加一个口令登录，不再继承进程启动令牌。`dsh web` 仍打印带该令牌的网址，供 supervisor 与机器客户端读取，但它自动打开的浏览器拿到的是干净网址。`ctx.connection.authorizeIndex` 对未认证的 index 请求返回一个自包含的 `200 text/html` 登录或设置文档，而不再是 401 文本；该页面向本插件注册在 `/connect` 旁边的路由提交 JSON：`POST /auth/setup` 在尚无口令时存入第一条口令，`POST /auth/login` 校验账号与口令，`POST /auth/logout` 清除浏览器 cookie。同一客户端地址与账号名的连续登录失败会面临倍增等待，上限三十秒。

口令保存在 `ctx.credentials` 中 owner 作用域的 `client-connection/password` grant 记录里，是参数由协议固定的 scrypt 摘要；`username`（默认 `dsh`）是新的配置字段，指明新设置表单里的账号名。浏览器 cookie 现在是版本 `v3`，并带上签发它的口令记录的 generation，由进程令牌签发的则带 `launch`，因此改口令或删除记录会让口令签发的 cookie 立即失效。版本 `v1` 的浏览器 cookie 被拒绝并落到登录页。API cookie 仍是版本 `v2`，`GET /connect?token=...` 保持已公布的约定，因此机器接入与桌面宿主继续免密。设置面板为服务页面新增 Sign out 动作；自持载体的调用方没有浏览器会话可结束，该动作自动隐藏。

## 迁移

1. 运维者在首次访问时设置口令：`dsh web` 之后打开的页面显示设置表单，赢得记录写入竞争的一方决定账号名与口令。忘记口令时删除 `client-connection/password` 记录并重启，页面随之回到设置形态。
2. 机器客户端继续使用启动行：读取打印出的网址，然后照旧在 `GET /connect?token=<launch-token>&interactions=none` 交换令牌。导航到 `/` 的浏览器自动化要么经 `/auth/login` 登录，要么继续在根路径交换启动令牌。
3. 按状态码判定 index 响应的集成方现在要改看 `content-type`：`401 text/plain` 的根响应意味着令牌交换被拒，`200 text/html` 意味着还没有浏览器会话。自行构造 `BrowserAuth` 的调用方把已加载的 `PasswordStore` 作为第四个参数传入（先 `new PasswordStore(ctx.credentials, username)`，再 `await passwords.load()`）。
4. 需要不同账号名的部署在 `@deepseek-ai/dsh-client-connection` 上设置 `username`。口令本身绝不进入 `cordis.yml`，因此配置文件不会泄露它。凡是从本机之外可达的 authority 都要配置 TLS：明文 HTTP 下 cookie 与提交的口令都不加密传输。
