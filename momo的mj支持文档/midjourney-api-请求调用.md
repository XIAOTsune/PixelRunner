# Midjourney 用户请求调用指南

本文只说明用户如何请求 `https://api.momoapi.icu`，不包含上游接口地址或上游密钥。

## 1. 可用模型与接口

当前 `midjourney` 渠道对用户开放的是 `mj_imagine` 文生图。

| 模型或能力 | 用户请求接口 | 是否支持 |
| --- | --- | --- |
| `mj_imagine` | `POST /mj/submit/imagine` | 支持 |
| 单个任务查询 | `GET /mj/task/{TASK_ID}/fetch` | 支持 |
| 批量任务查询 | `POST /mj/task/list-by-ids` | 支持 |
| 四宫格下载 | `GET /mj/image/{TASK_ID}` | 支持 |

`/mj/submit/imagine` 会自动使用 `mj_imagine`，请求体中不需要传 `model`。

`mj_variation`、`mj_reroll`、`mj_upscale`、`mj_blend`、`mj_describe`、`mj_upload` 可以在系统中配置定价，但当前这个渠道只接受 Imagine 首次生成。不要向该渠道提交其他 Midjourney 操作。

## 2. 认证方式

使用在 NewAPI 控制台创建的用户 API Key：

```http
Authorization: Bearer sk-你的NewAPI密钥
Content-Type: application/json
```

不要把真实密钥写入前端网页、公开仓库、截图或日志。

## 3. 提交文生图任务

接口：

```http
POST https://api.momoapi.icu/mj/submit/imagine
```

示例：

```bash
curl -X POST 'https://api.momoapi.icu/mj/submit/imagine' \
  -H 'Authorization: Bearer sk-你的NewAPI密钥' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Cinematic palace dance, warm daylight --ar 16:9 --v 8.2 --hd",
    "mode": "fast",
    "state": "order-20260809-001"
  }'
```

请求字段：

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `prompt` | 是 | string | 完整 Midjourney 提示词。版本、画幅、风格、Profile、HD 等参数都写在这里。 |
| `mode` | 否 | string | `fast` 或 `relax`。不传、传空值时默认 `relax`。 |
| `state` | 否 | string | 用户自己的订单号或业务关联标识。 |

NewAPI 不会替用户补写或删除提示词参数。调用方自行决定模型版本、画幅、风格、Profile 和 HD。

成功响应：

```json
{
  "code": 1,
  "description": "success",
  "result": "TASK_ID"
}
```

保存 `result`。提交成功仅表示任务进入队列，不表示图片已经生成完成。

## 4. Fast、Relax 与 HD 计费

| 请求方式 | 使用的基础价格 | HD 附加费 |
| --- | --- | --- |
| `mode: "fast"` | Fast 单次价格 | 没有独立 `--hd` 时不加 |
| `mode: "relax"` | Relax 单次价格 | 没有独立 `--hd` 时不加 |
| 不传 `mode` | Relax 单次价格 | 没有独立 `--hd` 时不加 |
| `mode: "fast"` 且提示词含 `--hd` | Fast 单次价格 | 加上 HD 附加价格 |
| `mode: "relax"` 且提示词含 `--hd` | Relax 单次价格 | 加上 HD 附加价格 |

最终预扣额度：

```text
(Fast 或 Relax 基础价格 + 已配置的 HD 附加价格) × 用户分组倍率
```

例如 Fast 为 `0.02`、HD 附加价为 `0.01`、分组倍率为 `1.0`：

```json
{
  "prompt": "a cinematic palace dance --v 8.2 --hd",
  "mode": "fast"
}
```

该请求的基础价格为 `0.03`。

`--hd` 必须是独立提示词参数。`--hdfoo` 不会触发 HD 附加费。管理员未配置 HD 附加价时，带 `--hd` 的请求仍仅按 Fast 或 Relax 基础价计算。

## 5. 查询任务和获取图片

查询接口：

```http
GET https://api.momoapi.icu/mj/task/TASK_ID/fetch
```

```bash
curl 'https://api.momoapi.icu/mj/task/TASK_ID/fetch' \
  -H 'Authorization: Bearer sk-你的NewAPI密钥'
```

处理中响应：

```json
{
  "id": "TASK_ID",
  "status": "IN_PROGRESS",
  "progress": "35%",
  "isCompleted": false
}
```

完成响应：

```json
{
  "id": "TASK_ID",
  "status": "SUCCESS",
  "progress": "100%",
  "isCompleted": true,
  "imageUrl": "https://api.momoapi.icu/mj/image/TASK_ID",
  "properties": {
    "images": [
      "https://cdn.example/0_0.png",
      "https://cdn.example/0_1.png",
      "https://cdn.example/0_2.png",
      "https://cdn.example/0_3.png"
    ]
  }
}
```

| `status` | 说明 |
| --- | --- |
| `IN_PROGRESS` | 正在排队或生成；建议等待 3 至 5 秒后再次查询。 |
| `SUCCESS` | 已完成。 |
| `FAILURE` | 已失败；读取 `failReason` 查看原因。 |

`imageUrl` 是四宫格图片代理地址。`properties.images` 是四张单图地址。

下载四宫格：

```bash
curl -L 'https://api.momoapi.icu/mj/image/TASK_ID' \
  -H 'Authorization: Bearer sk-你的NewAPI密钥' \
  -o mj-grid.png
```

批量查询：

```bash
curl -X POST 'https://api.momoapi.icu/mj/task/list-by-ids' \
  -H 'Authorization: Bearer sk-你的NewAPI密钥' \
  -H 'Content-Type: application/json' \
  -d '{"ids":["TASK_ID_1","TASK_ID_2"]}'
```

## 6. 可直接写入 prompt 的控制参数

以下参数由调用方直接写入 `prompt`。NewAPI 原样转发提示词，不会默认添加版本、画幅、HD 或风格参数。

| 用途 | 常用参数示例 |
| --- | --- |
| 模型版本 | `--v 6.1`、`--v 7`、`--v 8.2`、`--niji 7` |
| 画幅比例 | `--ar 1:1`、`--ar 16:9`、`--ar 9:16` |
| 风格 | `--style raw`、`--profile YOUR_PROFILE` |
| 风格化与随机性 | `--stylize 100`、`--chaos 20`、`--weird 100` |
| 质量与过程 | `--quality 1`、`--stop 80` |
| 可复现性 | `--seed 123456` |
| 排除内容 | `--no text, watermark, logo` |
| 平铺纹理 | `--tile` |
| HD / 2K | `--hd` |
| 图片参考 | 在提示词开头放图片 URL，配合 `--iw 1.5` |
| 风格参考 | `--sref 图片URL`、`--sw 100` |
| 角色参考 | `--cref 图片URL`、`--cw 100` |

完整示例：

```json
{
  "prompt": "https://example.com/reference.png 两位身穿白色汉服的宫廷舞者，暖金色光线，电影广角全景 --ar 16:9 --v 8.2 --style raw --stylize 150 --chaos 8 --no text, watermark --hd",
  "mode": "fast"
}
```

不同版本对提示词参数的支持范围可能不同，请以实际任务返回结果为准。

## 7. 不属于 prompt 的控制项

- `fast` / `relax`：使用请求 JSON 中的 `mode` 字段，不写在提示词中。
- 不传 `mode`：默认按 `relax` 请求和计费。
- `--hd`：属于提示词参数；带独立 `--hd` 时按“Fast 或 Relax 基础价 + HD 附加价”计费。
- U1、U2、U3、U4、V1、V2、V3、V4、Reroll、Upscale 等属于任务完成后的操作；当前此渠道只支持 `mj_imagine` 首次生成。

## 8. 用户调用流程

1. 调用 `POST /mj/submit/imagine`，传入非空 `prompt`。
2. 需要 Fast 时明确传 `mode: "fast"`；否则省略 `mode` 或传 `relax`。
3. 需要 HD / 2K 时，在 `prompt` 中加入独立的 `--hd`。
4. 保存返回的 `TASK_ID` 和自己的 `state`。
5. 每隔 3 至 5 秒查询 `/mj/task/TASK_ID/fetch`。
6. `SUCCESS` 后使用 `imageUrl` 获取四宫格，使用 `properties.images` 获取四张单图。
