# 阿里云盘接口笔记（一期：分享转存 + 哈希清单）

> 来源：`liupan1890/aliyunpan` 的 ADrive SDK 文档与 `src/renderer/aliapi/*`、`gaozhangmin/boxplayer` 的 `providerTransfers.ts` / `aliyunHttp.mjs` / `scansame.ts`。
> 这些都是**网页版同款接口**，不是阿里云盘开放平台。接口随版本变动，失效时优先对照这里。

## 本项目（0.6.0）用到的接口

| 用途 | 接口 |
|---|---|
| 刷新令牌 | `POST https://auth.aliyundrive.com/v2/account/token` |
| 分享凭证 | `POST https://api.aliyundrive.com/v2/share_link/get_share_token` |
| 分享信息（取名字） | `POST https://api.aliyundrive.com/adrive/v2/share_link/get_share_by_anonymous` |
| 列分享目录 | `POST https://api.aliyundrive.com/adrive/v3/file/list` |
| 转存（服务端复制） | `POST https://api.aliyundrive.com/v2/batch`，逐项 `/file/copy` |
| 路径转 id | `POST https://api.aliyundrive.com/v2/file/get_by_path` |
| 新建文件夹 | `POST https://api.aliyundrive.com/adrive/v2/file/createWithFolders` |
| 列自己网盘目录 | `POST https://api.aliyundrive.com/adrive/v3/file/list` |
| 单文件信息（补哈希） | `POST https://api.aliyundrive.com/v2/file/get` |

统一请求头：

```
Content-Type: application/json
Authorization: Bearer <access_token>     # 除分享凭证、匿名分享信息外都需要
x-share-token: <share_token>             # 访问分享内容时需要
```

---

## 1. 登录态

阿里云盘网页版把令牌放在 `localStorage.token`（JSON 字符串），字段包括
`access_token` / `refresh_token` / `default_drive_id` / `user_id` / `user_name`。

刷新（`refresh_token` 每次刷新都可能轮换，必须写回）：

```
POST https://auth.aliyundrive.com/v2/account/token
{ "refresh_token": "...", "grant_type": "refresh_token" }

→ { access_token, refresh_token, expires_in, default_drive_id, user_id, user_name, ... }
```

- `expires_in` 通常 7200 秒。
- 本项目提前 60 秒续期；刷新失败视为登录态失效，提示用户重新登录 alipan.com。

## 2. 分享凭证

```
POST https://api.aliyundrive.com/v2/share_link/get_share_token
{ "share_id": "xxxx", "share_pwd": "abcd" }      # 无提取码时 share_pwd 传空串

→ { "share_token": "..." }
```

常见错误：

| code | 含义 |
|---|---|
| `InvalidResource.SharePwd` | 提取码错误 / 缺提取码 |
| `NotFound.File`、`ShareExpired`、`ShareCanceled` | 分享不存在或已失效 |

## 3. 列分享目录

```
POST https://api.aliyundrive.com/adrive/v3/file/list?jsonmask=<mask>
Header: x-share-token: <share_token>
{
  "share_id": "...",
  "parent_file_id": "root",
  "limit": 100,
  "marker": "",              // 翻页时带上一页的 next_marker
  "order_by": "name",
  "order_direction": "ASC",
  "url_expire_sec": 14400,
  "fields": "thumbnail"
}
```

`jsonmask` 决定返回字段。本项目的 mask 额外带了 `content_hash` / `content_hash_name`；
如果服务端不认这两个字段会直接报错，所以调用方在失败时会去掉哈希字段重试一次。

文件条目关键字段：

```
file_id, name, size, type("file"|"folder"), parent_file_id,
content_hash, content_hash_name   // 一般 content_hash_name == "sha1"
```

> `content_hash` 是**整文件 SHA1**，和 115 秒传用的 `fileid` 同一套哈希体系。
> 分享目录是否稳定返回它取决于文件本身（加密/转码过的文件可能没有）。

## 4. 转存（服务端复制）

单条：

```
POST https://api.aliyundrive.com/v2/batch
Header: Authorization: Bearer <token>, x-share-token: <share_token>
{
  "resource": "file",
  "requests": [
    {
      "id": "<file_id>",
      "method": "POST",
      "url": "/file/copy",
      "headers": { "Content-Type": "application/json" },
      "body": {
        "share_id": "...",
        "file_id_list": [""],
        "file_id": "<file_id>",
        "to_drive_id": "<自己的 drive_id>",
        "to_parent_file_id": "<目标目录 id>",
        "auto_rename": true
      }
    }
  ]
}
```

- 一次最多 100 条请求；本项目按 50 条分批，更保守。
- 响应 `responses[]`，每项 `{ id, status, body }`；`status` 在 `200–205` 视为成功。
- 出现 `body.async_task_id` 表示服务端异步执行（大文件夹常见），本项目计为“已受理”。
- 转存是**阿里云盘服务端内部复制**，不经过本机，不消耗上行带宽。

常见错误码：

| code | 含义 |
|---|---|
| `QuotaExhausted.Drive` | 空间已满 |
| `ForbiddenName` | 文件名不合法 |
| `AlreadyExists` | 目标目录已有同名文件（本项目用 `auto_rename` 规避） |
| `ShareLinkExpired` | 分享已失效 |

## 5. 目录

```
POST https://api.aliyundrive.com/v2/file/get_by_path
{ "drive_id": "...", "file_path": "/115搬运/某个分享" }
→ { "file_id": "...", "type": "folder", ... }
```

路径不存在时返回带 `code` 的错误体（HTTP 404），而不是抛异常。

新建文件夹（会逐级创建缺失的父目录）：

```
POST https://api.aliyundrive.com/adrive/v2/file/createWithFolders
{
  "drive_id": "...",
  "parent_file_id": "root",
  "name": "115搬运",
  "type": "folder",
  "check_name_mode": "refuse"      // 同名时返回错误，由调用方回退到 get_by_path
}
```

## 6. 列自己网盘（生成哈希清单）

```
POST https://api.aliyundrive.com/adrive/v3/file/list?jsonmask=<mask>
Header: Authorization: Bearer <token>
{ "drive_id": "...", "parent_file_id": "<目录 id>", "limit": 100, "marker": "" }
```

本项目递归（最多 6 层、500 个文件）遍历转存目标目录，收集 `name / size / content_hash`。
列表没返回哈希的文件，再逐个用：

```
POST https://api.aliyundrive.com/v2/file/get
{ "drive_id": "...", "file_id": "..." }
→ { ..., "content_hash": "..." }
```

（单个补查上限 100 个，避免大目录打爆接口。）

---

## 7. 为什么一期只做到“存到自己的阿里云盘 + 哈希清单”

把文件真正搬进 115 有两条路：

1. **115 秒传** —— 需要 115 的 `uplb.115.com/4.0/initupload.php`，
   请求体要做 ECDH 加密，还要算 `sig` / `token`，且 ≥1MB 的文件会返回
   `status: 7` + `sign_check`，必须回传指定字节段的 SHA1。工程量在二期。
2. **115 离线下载** —— 把阿里直链交给 115 服务端拉取。直链有时效、可能绑 UA，
   成功率需要实测，作为二期的兜底方案。

一期产出的清单（文件名 / 大小 / SHA1）正好是二期秒传要用的输入。

## 8. 频率与限制

- 本项目阿里云盘请求走独立的 `AliQueue`，串行 + 260ms 间隔，**不占用 115 的请求配额**，
  115 的 `911` 也不会阻塞这里。
- 阿里云盘免费账号的分享转存有次数上限（社区实测约 300 次/年），批量搬运前留意。
- 分享直链下载对非会员有限速；本项目不走直链，转存是服务端操作。

## 9. 参考

- `liupan1890/aliyunpan`：`adrive sdk/*.md`、`src/renderer/aliapi/share.ts`、`filecmd.ts`、`utils.ts`
- `gaozhangmin/boxplayer`：`electron/main/mediary/providerTransfers.ts`、`clouddrive-cli/providers/aliyunHttp.mjs`、`src/rss/rssscansame/scansame.ts`
- 115 侧秒传协议见 `docs/115-api.md`
