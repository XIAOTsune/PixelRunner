# Midjourney Prompt 控制参数指南

本文说明通过 NewAPI 提交 `mj_imagine` 时，可以直接写进 `prompt` 的常用 Midjourney 控制参数。

请求接口：

```http
POST https://api.momoapi.icu/mj/submit/imagine
```

NewAPI 会将 `prompt` 原样提交。它不会替用户默认添加模型版本、画幅比例、HD、风格或 Profile。

## 1. 基本写法

将自然语言描述写在前面，将参数写在提示词末尾：

```text
两位身穿白色汉服的宫廷舞者，暖金色光线，电影广角全景 --ar 16:9 --v 8.2 --style raw --hd
```

对应请求：

```json
{
  "prompt": "两位身穿白色汉服的宫廷舞者，暖金色光线，电影广角全景 --ar 16:9 --v 8.2 --style raw --hd",
  "mode": "fast"
}
```

`mode` 不属于提示词参数；它是 JSON 请求字段。`fast` 和 `relax` 不要写成 `--fast` 或 `--relax`。

## 2. 模型与画幅

| 目的 | 参数 | 示例 |
| --- | --- | --- |
| 选择模型版本 | `--v 版本` | `--v 6.1`、`--v 7`、`--v 8.2` |
| Niji 风格模型 | `--niji 版本` | `--niji 7` |
| 设置画幅比例 | `--ar 宽:高` | `--ar 1:1`、`--ar 16:9`、`--ar 9:16`、`--ar 3:4` |
| HD / 2K | `--hd` | `--v 8.2 --hd` |

是否支持某一版本、版本名称或 `--hd`，取决于用户选择的实际模型版本和当前渠道能力。NewAPI 不会强制替换版本。

## 3. 风格与表现力

| 目的 | 参数 | 示例 |
| --- | --- | --- |
| Raw 风格 | `--style raw` | `portrait photo --style raw` |
| 个人化 Profile | `--profile 名称` | `--profile s7efs14` |
| 风格化强度 | `--stylize 数值` | `--stylize 100` |
| 随机性 | `--chaos 数值` | `--chaos 20` |
| 怪诞程度 | `--weird 数值` | `--weird 100` |

示例：

```text
赛博朋克雨夜街道，霓虹倒影，电影摄影，低机位广角 --ar 16:9 --v 8.2 --style raw --stylize 150 --chaos 8
```

## 4. 质量、过程与可复现性

| 目的 | 参数 | 示例 |
| --- | --- | --- |
| 质量档位 | `--quality 数值` | `--quality 1` |
| 提前停止 | `--stop 百分比` | `--stop 80` |
| 固定随机种子 | `--seed 整数` | `--seed 123456` |
| 平铺纹理 | `--tile` | `ornamental floral pattern --tile` |

固定 `--seed` 有助于重复测试相近构图，但提示词、版本、参数、上游调度或模型更新变化时，结果仍可能不同。

## 5. 排除元素

使用 `--no` 排除不希望出现的内容：

```text
古代宫廷舞蹈，红色地毯，金色雕刻，电影光线 --no text, watermark, logo, modern objects
```

多个排除项使用逗号分隔。`--no` 只能影响生成倾向，不能保证所有元素绝对不会出现。

## 6. 图片、风格与角色参考

图片 URL 可放在提示词开头，后面再写文字描述和控制参数。

| 目的 | 参数 | 示例 |
| --- | --- | --- |
| 图片参考权重 | `--iw 数值` | `--iw 1.5` |
| 风格参考 | `--sref 图片URL` | `--sref https://example.com/style.png` |
| 风格参考权重 | `--sw 数值` | `--sw 100` |
| 角色参考 | `--cref 图片URL` | `--cref https://example.com/character.png` |
| 角色参考权重 | `--cw 数值` | `--cw 100` |

图片参考示例：

```text
https://example.com/reference.png 中国古代宫廷舞蹈，白色汉服，暖金色大厅，电影广角全景 --iw 1.5 --ar 16:9 --v 8.2
```

风格和角色参考示例：

```text
优雅的中国宫廷舞者，白色汉服，金色凤冠 --cref https://example.com/character.png --cw 80 --sref https://example.com/style.png --sw 120 --ar 2:3 --v 8.2
```

参考图片必须是调用环境可访问的 URL。

## 7. Fast、Relax 与 HD 的正确组合

`fast` / `relax` 写在 JSON 的 `mode` 字段；`--hd` 写在 `prompt`：

```json
{
  "prompt": "Cinematic wide full shot, ancient Chinese palace performance --ar 16:9 --v 8.2 --hd",
  "mode": "fast"
}
```

此请求会按：

```text
Fast 基础价格 + HD 附加价格
```

再乘以用户分组倍率。没有传 `mode` 时默认 `relax`。

`--hd` 必须是独立参数；`--hdfoo` 不会识别为 HD，也不会触发 HD 附加费。

## 8. 当前渠道不支持的后续操作

U1、U2、U3、U4、V1、V2、V3、V4、Reroll、Upscale、Blend、Describe 等属于图片生成后的操作或其他 MJ 能力。当前 `midjourney` 渠道只支持 `mj_imagine` 首次生成，不能把这些操作作为该渠道的首个 `prompt` 请求。

## 9. 推荐模板

### 写实人物

```text
photorealistic portrait of an elegant Chinese woman in white hanfu, golden phoenix crown, soft window light, fine film grain --ar 2:3 --v 8.2 --style raw --stylize 80 --no text, watermark --hd
```

### 横向电影场景

```text
Cinematic wide full shot, ancient Chinese palace dance performance, vermilion columns, golden carvings, incense smoke, warm daylight, symmetrical composition --ar 16:9 --v 8.2 --style raw --stylize 120 --chaos 5 --no text, watermark, logo --hd
```

### 无缝纹理

```text
ornate Chinese cloud and floral brocade pattern, red and gold, fine silk texture --tile --ar 1:1 --v 8.2
```

## 10. 使用建议

1. 一次只修改一个参数，便于判断参数的实际效果。
2. 先使用较简单的提示词确认版本和画幅，再增加参考图和风格参数。
3. 需要对比构图时记录 `--seed`、版本和完整提示词。
4. 需要 HD / 2K 时明确加 `--hd`，并确认会产生 HD 附加计费。
5. 不要假定每个模型版本都支持所有参数；以任务实际返回结果为准。
