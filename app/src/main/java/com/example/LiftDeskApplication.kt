package com.example

import android.app.Application
import android.content.Context
import android.util.Log
import java.io.File

class LiftDeskApplication : Application() {

  override fun attachBaseContext(base: Context?) {
    super.attachBaseContext(base)
    base?.let { ensureCacheDirectories(it) }
  }

  override fun onCreate() {
    super.onCreate()
    ensureCacheDirectories(this)
  }

  companion object {
    fun ensureCacheDirectories(context: Context) {
      try {
        val rootDirs = mutableListOf<File>()
        try {
          rootDirs.add(context.cacheDir)
        } catch (_: Exception) {}
        try {
          rootDirs.add(context.codeCacheDir)
        } catch (_: Exception) {}
        try {
          context.applicationInfo?.dataDir?.let { dataPath ->
            rootDirs.add(File(dataPath, "cache"))
            rootDirs.add(File(dataPath, "app_webview"))
          }
        } catch (_: Exception) {}

        val subPaths = listOf(
            "WebView/Default/HTTP Cache/Code Cache/js",
            "WebView/Default/HTTP Cache/Code Cache/wasm",
            "WebView/Default/HTTP Cache/index-dir",
            "WebView/Default/Code Cache/js",
            "WebView/Default/Code Cache/wasm",
            "Default/HTTP Cache/Code Cache/js",
            "Default/HTTP Cache/Code Cache/wasm",
            "Default/HTTP Cache/index-dir"
        )

        for (root in rootDirs) {
          if (!root.exists()) {
            root.mkdirs()
          }
          for (sub in subPaths) {
            val targetDir = File(root, sub)
            if (!targetDir.exists()) {
              targetDir.mkdirs()
            }
          }
        }
      } catch (t: Throwable) {
        Log.w("LiftDeskApp", "Notice initializing cache structures: ${t.message}")
      }
    }
  }
}
