---
description: "浏览器访问 index 现在需要账号名与口令；浏览器 cookie 改为携带 generation 的 v3 版本；六条 /auth 路由与设置里的登录页一并加入 Web 载体。"
kind: upgrade-guide
---

# 浏览器改用账号名加口令登录

[English](guide.md) | 中文

## 变更

浏览器打开被服务的界面时，现在用一个账号名加一个口令认证，而不再沿用启动令牌。`dsh web` 仍打印带该令牌的网址供 supervisor 与机器客户端使用，但它自动打开的浏览器拿到的是干净网址。未认证的 index 请求现在返回一个自包含的 `200 text/html` 登录或设置页，而不是 401 文本。该页面与设置面板向本插件在 `/connect` 旁拥有的六条路由提交 JSON：`/auth/setup`、`/auth/login`、`/auth/logout` 服务尚未登录的浏览器；`/auth/state`、`/auth/change`、`/auth/revoke` 服务已登录的浏览器——改口令先要证明当前口令，revoke 则登出其他所有靠口令登录的浏览器。同一客户端地址连续失败会面临从一秒起倍增、上限三十秒的等待。表单要求输入两遍口令，并提供「记住我」，不勾选即表示会话随浏览器关闭结束。

口令存放在 owner 作用域的 `client-connection/password` grant 记录里，由 scrypt 摘要加一个 32 字节的 `sessionEpoch` 组成；配置项 `username`（默认 `dsh`）是新字段，决定首次设置表单给出的账号名。该格式的版本 `1` 记录仍然可读，并保持既有登录态不被踢掉，直到某次修改或替换会话把它重写为版本 `2`。浏览器 cookie 是版本 `v3`，带上由该记录哈希出的 generation；进程令牌换出的则带 `launch`：改口令或替换会话都会立即作废口令签发的 cookie，`v1` cookie 被拒绝，API cookie 仍是版本 `v2`。`GET /connect?token=...` 的对外约定不变，因此机器访问与桌面宿主继续免密。设置里新增「登录认证」分区，排在「通用设置」上面，只出现在由 Host 持有会话的页面上：它先把已登录账号摆在最前，点该行进入账号与密码的修改视图，并把「退出登录」与「登出其他设备」排在账号行下面，而不再挂在面板右上角。每次认证结果都经 `ctx.logger` 写一行，只含账号名与对端地址，绝不含口令。

## 迁移

1. 首次访问就设置口令：赢得记录竞争的那一方决定账号名与口令。之后再改需要证明当前口令，所以忘记口令的恢复办法仍是删除 `client-connection/password` 记录并重启。
2. 机器客户端继续用打印出的网址与 `GET /connect?token=<launch-token>&interactions=none`。访问 `/` 的浏览器自动化要么经 `/auth/login` 登录，要么继续在根路径交换启动令牌。
3. 判断 index 响应要看 `content-type`，不能只看状态码：`401 text/plain` 是被拒绝的令牌交换，`200 text/html` 是登录页。自行构造 `BrowserAuth` 的调用方要把已加载的 `PasswordStore` 作为第四个参数传入。
4. 想换账号名就在 `@deepseek-ai/dsh-client-connection` 上设置 `username`。口令本身从不进入 `cordis.yml`，配置文件因此不会泄露它。凡能被本机之外访问的 authority 都要配好 TLS：明文 HTTP 下 cookie 与提交的口令都不加密。
