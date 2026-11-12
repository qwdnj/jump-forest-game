package com.dsh.gamebox;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 一个极薄的 WebView 外壳：把仓库里的网页游戏原样装进来，
 * 好处是网页更新了，APK 只要重新打一次就同步了，不用维护两套代码。
 *
 * 踩过的坑：app 里跑的是 file:///android_asset/…，没有 HTTP 服务器，
 * WebView 不会把目录地址自动补成 index.html。所以「./jump/」这种链接在线上
 * GitHub Pages 能打开，装进 APK 就变成 file:///android_asset/jump/ →
 * net::ERR_FILE_NOT_FOUND（网页无法打开）。
 * 现在两边一起治：页面里写全路径 jump/index.html，这里再给裸目录兜个底。
 */
public class MainActivity extends Activity {

    private static final String HOME = "file:///android_asset/index.html";
    private static final String ASSET_PREFIX = "file:///android_asset/";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 玩的时候别让屏幕熄灭
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0F1F18);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 排行榜、最高分存在 localStorage 里
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(view, request.getUrl());
            }
        });
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        setContentView(web);
        web.loadUrl(HOME);
    }

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

    @Override
    public void onBackPressed() {
        // 从游戏返回选单，而不是直接退出
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
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
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
