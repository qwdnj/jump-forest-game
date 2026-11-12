# 这个 App 没有第三方依赖，唯一要护住的是被系统回调的入口类。
# 名字被 R8 改掉的话，WebViewClient / 返回键这些框架回调就找不到方法了。

# Activity 由 AndroidManifest 启动，连同里面的匿名 WebViewClient 一起保名
-keep class com.dsh.gamebox.MainActivity { *; }
-keep class com.dsh.gamebox.MainActivity$* { *; }
