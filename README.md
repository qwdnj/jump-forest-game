# 小游戏合集

两个能直接在手机浏览器里玩的单文件 HTML5 小游戏，不用装、不用联网，打开就能玩。

在线玩：<https://qwdnj.github.io/jump-forest-game/>

## 目录

| 游戏 | 地址 | 一句话 |
| --- | --- | --- |
| 跳一跳 · 森林 | [`jump/`](jump/) | 按住蓄力、松开起跳，简单/困难两种难度，攒分解锁皮肤 |
| 海滩猴子大冒险 | [`monkey/`](monkey/) | 带着猴子在沙滩上跑，按得越久跳得越高 |

根目录的 `index.html` 是选游戏的入口页。

## 跳一跳 · 森林

- 按住屏幕蓄力，松开跳跃；落在柱子正中 = 完美（连击越高加得越多）
- 绿色弹簧柱额外加分；**蓝色钢柱会左右移动**（地面有滑轨提示）
- 落点预览按「落地那一刻」的位置算，所以预览不会骗人
- 难度分两段收紧：30 分前快速收紧，30~150 分继续慢慢变难
- 天色随分数推进：白天 → 黄昏；分数越高星星越亮
- 右上角「全屏」按钮：浏览器里是 Fullscreen API，APK 里由外壳真正切横屏

### 难度模式（v1.2.0）

暂停面板 →「设置」，或者游戏结束后点「设置」，可以换难度。
**换难度会直接重开一局**（两套物理不一样，中途换没有意义），两种模式的最高分分开记。

| | 简单 | 困难 |
| --- | --- | --- |
| 轨迹 | 抛物线（有竖直初速、会旋转） | **取消抛物线**：贴柱顶等高直线冲刺，到点垂直落下 |
| 落点预览 | 完整抛物线 + 落点圈 + 加分预览 | 只有一小段直线和箭头，不给终点 |
| 平台 | 原样 | 宽度 ×0.84、间距 ×1.14，窄到 26px 就会停住 |
| 救援 | 边缘 7px 内算「惊险」 | 1.5px 以内，几乎等于没有 |
| 完美判定 | 平台宽 ×0.12 | 平台宽 ×0.09 |
| 弹簧/摆柱 | 16% / 17% | 10% / 30% |
| 计分 | 原样 | 每次落地额外 +1 |

实现上没有两套物理代码：起跳时按模式决定「是抛物线还是直线冲刺」，
落地判定都走同一个 `resolveLanding()`，只是抛物线在越过柱顶的那一刻调用，
直线冲刺在冲刺时间结束的那一刻调用。所以预览、判定、加分不会出现两套规则打架。

### 皮肤系统（v1.2.0）

设置面板里换皮肤，换完立刻生效（改配色 + 头顶零件，跳跃手感不变）。
解锁条件是**两个模式里较高的那个最高分**：

| 皮肤 | 解锁 | 特点 |
| --- | --- | --- |
| 森林橘 | 0 分 | 原版小人 |
| 薄荷青 | 0 分 | 青色 + 一片小叶子 |
| 小蜜蜂 | 15 分 | 黄黑条纹 + 触角 |
| 小雪人 | 30 分 | 冷白 + 自带冷光 |
| 夜行者 | 50 分 | 深灰 + 金色眼睛 |
| 黄金甲 | 80 分 | 金色 + 暖光 |

## 海滩猴子大冒险

- 点击或按住跳跃键，按得越久跳得越高
- 支持皮肤、横版切换、设置、暂停、本机排行榜

## 说明

- 全部逻辑都在单个 HTML 文件里（Canvas 2D），无外部依赖
- 分数与记录存在浏览器 localStorage，换设备不同步
- 自适应分辨率：掉帧会自动降档渲染
- 手机上从选单进游戏后，按浏览器返回键回到选单

## 安装包（APK）

仓库里的 `android/` 是个很薄的 WebView 外壳（Java，无第三方依赖），构建时把 `index.html`、`jump/`、`monkey/` 拷进 assets。
每次 push 到 main，GitHub Actions 会自动编译并挂到 Releases：

<https://github.com/qwdnj/jump-forest-game/releases/latest>

下载 `app-debug.apk` 安装即可（debug 签名，安装时需要在手机系统设置里允许「安装未知来源应用」）。
APK 里的网页和线上版本是同一份源码，改了网页重新构建就会同步。

构建时会先跑 `node tools/check-assets.js`：检查 assets 里所有页面引用的本地链接都落在真实文件上。
另外 `node tools/mode-test.js jump/index.html` 会用同一套打桩 DOM 真的跑一遍两种难度和皮肤切换，
断言「困难模式冲刺全程 y 一点没变」（也就是真的没有抛物线）、两种最高分互不覆盖、皮肤按解锁分拦截。

### 选单页滚动（v1.1.1）

之前 `body` 被写死成 `height:100%`，它就是个定高的 flex 容器，
两张游戏卡片作为列方向的 flex item 会被 `flex-shrink` 压扁，
再撞上 `.card` 的 `overflow:hidden`，卡片底部的「开始玩」直接被裁掉；
页面刚好不溢出，所以怎么上滑都滚不动。现在 `body` 只给 `min-height`，
卡片 `flex:none`，内容多高就多高，滚动交还给文档。

### 横屏（v1.1.1）

跳一跳的「全屏」按钮原本只做两件事：`requestFullscreen()` 然后
`screen.orientation.lock("landscape")`。这两样在 WebView 里都不可用
（外壳没实现 `onShowCustomView`，锁方向还要求先真的进了全屏），
所以装进 APK 之后横屏永远是死的。

现在外壳用 `addJavascriptInterface` 注入了一个 `window.GameShell`：

| 页面 | 原生 |
| --- | --- |
| `GameShell.setGameMode(true)` | `SCREEN_ORIENTATION_SENSOR_LANDSCAPE` + 藏起状态栏/导航栏 |
| `GameShell.setGameMode(false)` | 还原成 `SCREEN_ORIENTATION_UNSPECIFIED`（跟随重力感应） |

页面上检测到 `GameShell` 就走这条路，检测不到（普通浏览器 / 线上版）还是原来的
全屏 API。回到选单（`onPageStarted` 命中 `index.html`，或选单页自己调一次）会把方向还回去。

### 这个壳都做了什么（v1.1.1）

| | |
| --- | --- |
| 启动 | 原生启动页（渐变底 + 标题 + 进度条），`onPageFinished` 后 260ms 淡出，不再白屏 |
| 返回 | 游戏里返回到选单；在选单要**连按两下**才退出，手滑不会把游戏关掉 |
| 切后台 | `onPause` 交给 WebView，页面自己再 `visibilitychange` 暂停，回来是暂停面板 |
| 崩溃 | 渲染进程被系统回收时 `onRenderProcessGone` 重建 WebView，不会连带整个 App 闪退 |
| 误触 | 关掉长按选择/保存图片、双击缩放、下拉回弹 |
| 横屏 | 跳一跳点「全屏」→ 原生真的转横屏 + 沉浸式；回选单自动还原 |
| 选单 | 页面可以正常上下滑动，卡片不再被压扁（v1.1.1） |
| 出错 | `onReceivedError` 给一张能「重新加载」的错误页 |
| 音量 | `setVolumeControlStream(STREAM_MUSIC)`，音量键调的是游戏音效 |
| 安全 | 关闭 `setWebContentsDebuggingEnabled`、跨文件访问、混合内容、明文流量(cleartext) |
| 体积 | R8 压缩 + 资源裁剪；图标改成 8bit 调色板 PNG（13.8 KB → 6.1 KB） |

> 注意：assets 里的三份 HTML 已经不压缩了 —— zip 本身就会 deflate，
> 再套一层 gzip 反而省不了多少，只多一层解压开销，所以没做。

### 页面链接的写法（重要）

app 里是 `file:///android_asset/…`，**没有 HTTP 服务器帮着补 index.html**，
所以链接必须写全文件名：

- ✅ `<a href="./jump/index.html">`
- ❌ `<a href="./jump/">` —— 线上 GitHub Pages 能开，装进 APK 就是 `net::ERR_FILE_NOT_FOUND`

外壳里也留了兜底：`MainActivity.shouldOverrideUrlLoading` 会把
`file:///android_asset/jump/`（以及不带后缀的 `…/jump`）补成 `…/jump/index.html`，
外链（http/https）则交给系统浏览器打开。

### 签名（关系到能不能直接覆盖安装）

`android/keystore/gamebox.p12` 是固定签名用的密钥库，口令/别名都是 `gamebox`，
证书指纹记在同目录的 `cert-sha256.txt`，`app/build.gradle` 里的 `signingConfigs.debug` 用它。

它是**公开的调试用密钥**，只为让每次构建签名一致（否则每次 CI 都是新密钥，新包装不到旧包上）。
不适合当正式发布密钥用；要换的话重新生成、重新填指纹，并且所有人得卸载一次才能装。


