# 🎓 气象培训平台自动学习助手

> 油猴脚本 | 适用于 `https://pxkckj-cmatc.cma.cn`

自动完成气象培训平台的课件学习：弹窗拦截、静音、视频进度监控、课件自动切换。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🖱 弹窗拦截 | 自动拦截 `alert/confirm/prompt`，自动点击页面弹窗确认按钮 |
| 🔇 自动静音 | 页面所有视频/音频自动静音，新增媒体元素也自动静音 |
| 🎬 视频监控 | 实时显示视频播放进度（时间/百分比/播放状态） |
| 📊 课件进度 | 显示已完成/总数，自动识别课件完成状态（通过 `done_icon_show` class） |
| ⏭ 自动切换 | 当前视频播放结束后，自动点击下一个未播放的课件 |
| 📂 目录展开 | 切换课件时自动展开右侧目录章节/讲次 |
| 📈 状态面板 | 可拖拽/可折叠的浮动面板，显示运行时间、学习时长、当前课件、调试信息 |

## 📦 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 Tampermonkey → 添加新脚本
3. 粘贴 [`cma-auto-learn.user.js`](./cma-auto-learn.user.js) 全部内容
4. 保存后访问 `https://pxkckj-cmatc.cma.cn` 任意课程页面

或直接通过 GitHub Raw URL 安装：
```
https://raw.githubusercontent.com/<username>/cma-auto-learn/main/cma-auto-learn.user.js
```

## 🖥 面板说明

脚本运行后，页面右上角会出现浮动面板：

```
⏱ 运行: 3分42秒 | 🖱 弹窗: 5次
📚 学习时长:07:42:10
📖 网页课件：风云卫星数据在暴雨等强对流天气...
📊 课件: 6/7 (剩余 1)
🎬 07:04 / 32:51 (22%)
▶ 播放中 | 🔇 静音
```

- 面板可**拖拽**移动
- 点击 **▼** 可折叠/展开
- 底部显示实时日志

## ⚙️ 配置

脚本顶部可调整参数：

```javascript
const CONFIG = {
    CHECK_INTERVAL: 500,        // 主循环检查间隔 (ms)
    VIDEO_END_THRESHOLD: 3,     // 视频结束判定阈值 (秒)
    NEXT_COURSE_DELAY: 2000,    // 切换下一个课件的延迟 (ms)
    POPUP_CHECK_INTERVAL: 800,  // 弹窗检查间隔 (ms)
    MAX_WAIT: 60000,            // 最长等待元素加载时间 (ms)
};
```

## 📋 更新记录

### v2.1.0 (2026-07-24)

**课件切换逻辑重构**

- 🐛 修复：中间遗漏课件的问题 — 新增 `scriptVisited` Set 追踪所有已访问课件，按顺序前进不回退
- 🐛 修复：切换课件后平台标记完成导致误判 — 使用 `originallyDone` 记录启动时状态作为基准
- 🐛 修复：点击已完成课件后无法正确获取当前课件标题 — 新增 `lastClickedItemId` 追踪用户点击
- ✨ 新增：课件完成状态检测双重机制 — 优先检查 `done_icon_show` class（平台真实状态），回退检查 `completestate` 属性
- ✨ 新增：最后一个未完成课件播放完毕后不再切换

### v2.0.0 (2026-07-23)

**架构重写**

- 🐛 修复：多个监控面板问题 — 只在顶层窗口运行，iframe 内只做弹窗拦截+静音
- 🐛 修复：无法获取视频和课件状态 — 去掉 `#mainFrame` iframe 假设，同时搜索主页面和所有 iframe
- ✨ 新增：`waitForElements()` 等待元素加载（最多60秒）
- ✨ 新增：`MutationObserver` 监听动态内容加载
- ✨ 新增：页面结构扫描调试功能
- ✨ 新增：运行时间记录
- ✨ 新增：弹窗点击次数记录
- ✨ 新增：页面学习时长获取
- ✨ 新增：当前播放课件标题显示

### v1.2.0 (2026-07-23)

- 🐛 修复：iframe 内弹窗拦截
- 🐛 修复：iframe src 变化时重置视频状态
- ✨ 新增：`getIframeDoc()` 三级回退访问 iframe

### v1.0.0 (2026-07-23)

**初始版本**

- ✨ 自动弹窗确定按钮点击
- ✨ 自动静音页面
- ✨ 视频播放进度监控
- ✨ 视频结束后自动切换下一个未完成课件
- ✨ 浮动状态面板

## 🔧 技术细节

- 双上下文架构：顶层窗口运行完整功能，iframe 内只做弹窗拦截+静音
- 课件列表和视频可能分布在主页面或 iframe 中，脚本自动搜索所有层级
- 通过 `.item_done_icon.done_icon_show` class 判断课件真实完成状态
- 使用 `originallyDone` + `scriptVisited` 双 Set 机制确保课件按序处理

## 📄 License

MIT
