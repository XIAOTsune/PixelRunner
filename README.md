# 小T修图助手 (PixelRunner)

一个基于 Adobe Photoshop UXP 的 RunningHub AI 插件，用于在 Photoshop 内快速选择并运行 RunningHub 应用，将结果图自动回贴到画布。

## 功能概览

- 解析并保存 RunningHub 应用（支持输入应用 ID 或应用 URL）
- 动态渲染应用参数（图片、文本、数字、下拉、开关）
- 下拉参数自动解析与清洗（含比例/分辨率等常见字段）
- 提示词模板保存、加载与编辑
- 运行任务、轮询结果并回贴到 Photoshop
- API Key 测试与账户余额信息显示

## 环境要求

- Adobe Photoshop 23.0.0+
- UXP 开发者工具（用于本地加载插件）
- RunningHub API Key

## 快速开始

1. 克隆仓库：

```bash
git clone <your-repo-url>
cd PixelRunner
```

2. 打开 UXP 开发者工具，选择 `Add Plugin`。
3. 选择本项目根目录下的 `manifest.json`。
4. 在 Photoshop 中打开插件面板：`小T修图助手`。

## 使用流程

1. 在设置页填写并保存 RunningHub API Key。
2. 输入应用 ID 或 RunningHub 应用链接并点击“解析”。
3. 保存应用后，切换到工作区选择应用并填写参数。
4. 若有图片输入，先在 Photoshop 中框选区域并点击“从 PS 选区获取”。
5. 点击“开始运行”，等待结果自动回贴。

## 项目结构

```text
PixelRunner/
├─ manifest.json          # UXP 插件清单
├─ index.html             # 面板页面
├─ style.css              # 面板样式
├─ index.js               # 入口
├─ icons/                 # 插件图标
└─ src/
   ├─ app-controller.js   # UI 与交互控制
   ├─ runninghub.js       # RunningHub API 调用与参数解析
   ├─ ps.js               # Photoshop 侧操作封装
   ├─ store.js            # 本地存储
   ├─ config.js           # 配置与接口常量
   └─ utils.js            # 通用工具
```

## 注意事项

- API Key 与应用配置存储在本地（`localStorage`），不会自动上传到仓库。
- 发布到 GitHub 前，建议确认未提交个人敏感信息。

## License

可根据你的发布需求添加（例如 MIT）。
