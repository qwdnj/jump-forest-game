package com.dsh.gamebox;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 一个极薄的 WebView 外壳：把仓库里的网页游戏原样装进来，
 * 好处是网页更新了，APK 只要重新打一次就同步了，不用维护两套代码。
 *
 * 踩过的坑：app 里跑的是 file:///android_asset/…，没有 HTTP 服务器，
 * WebView 不会把目录地址自动补成 index.html。所以「./jump/」这种链接在线上
 * GitHub Pages 能打开，装进 APK 就变成 file:///android_asset/jump/ →
 * net::ERR_FILE_NOT_FOUND（网页无法打开）。
 * 现在两边一起治：页面里写全路径 jump/index.html，这里再给裸目录兜个底。
 *
 * 1.1.0 补的体验 / 稳定性：
 *   - 原生启动页：点开图标立刻有画面，不用对着空夜色等 WebView 起来
 *   - 主菜单按返回要按两下才退出，手滑不会把游戏关掉
 *   - 渲染进程被系统回收后自动重建 WebView（以前会连带整个 App 闪退）
 *   - 长按不再弹「选择文字 / 保存图片」，玩的时候不容易误触
 *   - 加载失败给一个能重试的错误页，而不是白屏
 *   - 音量键直接调媒体音量；关掉调试桥、跨文件访问、混合内容
 */
public class MainActivity extends Activity {

    private static final String TAG = "GameBox";
    private static final String HOME = "file:///android_asset/index.html";
    private static final String ASSET_PREFIX = "file:///android_asset/";

    private static final int BG = 0xFF0F1F18;
    private static final int ACCENT = 0xFF7EE9A8;
    private static final int FG = 0xFFF3F7F2;

    private FrameLayout root;
    private WebView web;

    private LinearLayout splash;
    private TextView splashTip;
    private ProgressBar bar;
    private TextView errorTip;
    private TextView retry;

    private boolean gameMode;     // 网页要了横屏/沉浸（跳一跳的「全屏」按钮）
    private boolean ready;        // 首屏画出来了没
    private boolean failed;       // 加载失败了
    private long bootAt;          // 冷启动时刻，用来记「多久能玩」
    private long lastBackAt;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bootAt = SystemClock.uptimeMillis();
        // 玩的时候别让屏幕熄灭
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // 音量键直接调媒体音量（游戏音效），而不是铃声
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        // 壳里的页面不需要远程调试
        WebView.setWebContentsDebuggingEnabled(false);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        createWebView();
    }

    /* ---------------------------------------------------------------
     *  WebView
     * --------------------------------------------------------------- */

    private void createWebView() {
        try {
            web = new WebView(this);
        } catch (Throwable t) {
            // 极少数机器上系统 WebView 被禁用或卸载，new WebView 会直接抛
            Log.e(TAG, "WebView 创建失败", t);
            showError("这台机器上的 Android System WebView 用不了，去应用商店更新一下再打开");
            return;
        }

        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        // 长按不弹「选择文字 / 保存图片」，玩的时候不容易误触
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true;
            }
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);            // 游戏本体是 JS
        s.setDomStorageEnabled(true);            // 排行榜、最高分存在 localStorage 里
        s.setAllowFileAccess(true);              // 要读 file:///android_asset
        s.setAllowContentAccess(false);
        // 页面之间不需要跨文件读，只有选单链接到游戏页；关掉更安全
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // 网页里的 window.GameShell：WebView 自己切不了方向，得让原生代劳
        web.addJavascriptInterface(new ShellBridge(), "GameShell");

        web.setWebViewClient(new GameClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                if (bar != null && !ready) bar.setProgress(progress);
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        bringSplashFront();

        web.loadUrl(HOME);

        // 万一 onPageFinished 迟迟不来（老机器上偶发），别一直卡在启动页
        root.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!ready && !failed) showWeb();
            }
        }, 3000);
    }

    private final class GameClient extends WebViewClient {

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            // 回到选单就把横屏/全屏还回去，别让菜单也跟着横着
            if (gameMode && (url == null || url.equals(HOME))) setGameMode(false);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(view, request == null ? null : request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            showWeb();
        }

        /**
         * 内容已经画出来了（API 23+）。比 onPageFinished 早，
         * 用它在首屏真正可见时就撤启动页，能少黑一小会儿。
         */
        @Override
        public void onPageCommitVisible(WebView view, String url) {
            showWeb();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request != null && !request.isForMainFrame()) return;   // 子资源失败不用管
            Log.e(TAG, "主页面加载失败");
            failed = true;
            showError("页面没加载出来，可能是安装包不完整。点下面重试一次");
        }

        /**
         * 渲染进程被系统回收（内存紧张、WebView 自己崩了）。
         * 不处理的话整个 App 会被一起杀掉，这里重建一个 WebView 接着用。
         *
         * @return true 表示「我自己处理了」，别让系统把 Activity 也收走
         */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.w(TAG, "渲染进程没了，重建 WebView");
            if (view != null) {
                root.removeView(view);
                view.destroy();
            }
            web = null;
            ready = false;
            failed = false;
            if (bar != null) bar.setProgress(0);
            showSplash();
            createWebView();
            return true;
        }
    }

    /* ---------------------------------------------------------------
     *  网页 → 原生：横屏 / 沉浸式
     *
     *  为什么不让网页自己切：外壳里跑的是 WebView，不支持 Fullscreen API，
     *  requestFullscreen() 点了没反应；而 screen.orientation.lock() 规定必须先
     *  全屏成功才允许调用，于是跳一跳右上角那个「全屏」按钮在 APK 里是死的，
     *  横屏永远切不过去。改成页面喊一声、原生真的去转屏。
     * --------------------------------------------------------------- */

    /** 网页里的 window.GameShell：目前只负责横屏/全屏 */
    private final class ShellBridge {

        @JavascriptInterface
        public void setGameMode(final boolean on) {
            // JS 桥回调在 JavaBridge 线程上，碰 UI 必须回主线程
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (isFinishing() || isDestroyed()) return;
                    MainActivity.this.setGameMode(on);
                }
            });
        }
    }

    /**
     * @param on true = 横屏 + 藏起状态栏/导航栏；false = 交给系统（跟随重力感应）
     */
    private void setGameMode(boolean on) {
        gameMode = on;
        try {
            setRequestedOrientation(on
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        } catch (Throwable t) {
            // 个别 ROM 会拦，拦了也不该崩
            Log.w(TAG, "切换屏幕方向失败", t);
        }
        applyImmersive(on);
    }

    @SuppressWarnings("deprecation")
    private void applyImmersive(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            // API 30+ 这几个 flag 被标了 deprecated 但依然生效；
            // 这个壳没有 AndroidX，就不为它去引依赖了。
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            decor.setSystemUiVisibility(0);
        }
    }

    /* ---------------------------------------------------------------
     *  链接：assets 目录兜底 + 外链交给系统浏览器
     * --------------------------------------------------------------- */

    /**
     * @return true 表示已经自己处理掉，WebView 别再按原地址加载
     */
    private boolean handleUrl(WebView view, Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();

        if ("file".equals(scheme)) {
            String fixed = withIndexHtml(uri);
            if (fixed != null) {
                view.loadUrl(fixed);
                return true;
            }
            return false;
        }

        // http/https（比如选单底部的「下载 APK」）交给系统浏览器，别在游戏外壳里乱跳
        if ("http".equals(scheme) || "https".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }
        return false;
    }

    /**
     * file:///android_asset/jump/ 或 file:///android_asset/jump（都不带文件后缀）
     * 补成 file:///android_asset/jump/index.html；已经是具体文件则返回 null。
     */
    private static String withIndexHtml(Uri uri) {
        String s = uri.toString();
        if (!s.startsWith(ASSET_PREFIX)) return null;
        String path = s.substring(ASSET_PREFIX.length());
        if (path.isEmpty()) return ASSET_PREFIX + "index.html";
        if (path.indexOf('#') >= 0 || path.indexOf('?') >= 0) return null;
        if (path.endsWith("/")) return ASSET_PREFIX + path + "index.html";
        String tail = path.substring(path.lastIndexOf('/') + 1);
        if (tail.indexOf('.') < 0) return ASSET_PREFIX + path + "/index.html";
        return null;
    }

    /* ---------------------------------------------------------------
     *  启动页 / 错误页
     * --------------------------------------------------------------- */

    private LinearLayout buildSplash() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        // 盖着的时候把点击吃掉，否则手指会穿透到下面还在加载的 WebView 上
        col.setClickable(true);
        col.setFocusable(true);
        col.setBackground(new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF1D4437, BG}));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(FG);
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);
        col.addView(title);

        splashTip = new TextView(this);
        splashTip.setText("跳一跳 · 森林　海滩猴子大冒险");
        splashTip.setTextColor(0x8CF3F7F2);
        splashTip.setTextSize(12);
        splashTip.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tipLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tipLp.topMargin = dp(10);
        col.addView(splashTip, tipLp);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            bar.setProgressTintList(ColorStateList.valueOf(ACCENT));
            bar.setProgressBackgroundTintList(ColorStateList.valueOf(0x33FFFFFF));
        }
        LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(dp(140), dp(3));
        barLp.topMargin = dp(18);
        col.addView(bar, barLp);

        errorTip = new TextView(this);
        errorTip.setTextColor(0xCFF3F7F2);
        errorTip.setTextSize(13);
        errorTip.setGravity(Gravity.CENTER);
        errorTip.setVisibility(View.GONE);
        LinearLayout.LayoutParams errLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        errLp.topMargin = dp(14);
        errLp.leftMargin = dp(28);
        errLp.rightMargin = dp(28);
        col.addView(errorTip, errLp);

        retry = new TextView(this);
        retry.setText("重新加载");
        retry.setTextColor(BG);
        retry.setTextSize(13);
        retry.setGravity(Gravity.CENTER);
        retry.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(ACCENT);
        pill.setCornerRadius(dp(999));
        retry.setBackground(pill);
        retry.setPadding(dp(20), dp(9), dp(20), dp(9));
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                reload();
            }
        });
        LinearLayout.LayoutParams retryLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        retryLp.topMargin = dp(18);
        col.addView(retry, retryLp);

        return col;
    }

    /** 启动页永远盖在 WebView 上面 */
    private void bringSplashFront() {
        if (root != null && splash != null) root.bringChildToFront(splash);
    }

    private void showSplash() {
        if (splash == null) return;
        splash.setAlpha(1f);
        splash.setVisibility(View.VISIBLE);
        bringSplashFront();
        if (bar != null) bar.setVisibility(View.VISIBLE);
        if (splashTip != null) splashTip.setVisibility(View.VISIBLE);
        if (errorTip != null) errorTip.setVisibility(View.GONE);
        if (retry != null) retry.setVisibility(View.GONE);
    }

    /** 首屏就绪：启动页淡出，露出游戏 */
    private void showWeb() {
        if (ready || splash == null) return;
        ready = true;
        failed = false;
        Log.d(TAG, "首屏就绪，冷启动 " + (SystemClock.uptimeMillis() - bootAt) + "ms");
        splash.animate().alpha(0f).setDuration(260).withEndAction(new Runnable() {
            @Override
            public void run() {
                splash.setVisibility(View.GONE);
                splash.setAlpha(1f);
            }
        });
    }

    private void showError(String msg) {
        failed = true;
        if (splash == null) return;
        splash.setAlpha(1f);
        splash.setVisibility(View.VISIBLE);
        bringSplashFront();
        if (bar != null) bar.setVisibility(View.GONE);
        if (splashTip != null) splashTip.setVisibility(View.GONE);
        if (errorTip != null) {
            errorTip.setText(msg);
            errorTip.setVisibility(View.VISIBLE);
        }
        if (retry != null) retry.setVisibility(View.VISIBLE);
    }

    private void reload() {
        failed = false;
        ready = false;
        if (bar != null) {
            bar.setProgress(0);
            bar.setVisibility(View.VISIBLE);
        }
        if (splashTip != null) splashTip.setVisibility(View.VISIBLE);
        if (errorTip != null) errorTip.setVisibility(View.GONE);
        if (retry != null) retry.setVisibility(View.GONE);
        if (web == null) {
            createWebView();
        } else {
            web.loadUrl(HOME);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /* ---------------------------------------------------------------
     *  生命周期 / 返回键
     * --------------------------------------------------------------- */

    @Override
    public void onBackPressed() {
        // 从游戏返回选单，而不是直接退出
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (now - lastBackAt < 2000) {
            super.onBackPressed();
            return;
        }
        lastBackAt = now;
        Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
