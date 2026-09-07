package com.example

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.example.ui.theme.MyApplicationTheme
import java.io.File
import java.io.FileOutputStream

class MainActivity : ComponentActivity() {

  private var rootContainer: FrameLayout? = null
  private var webView: WebView? = null
  private var filePathCallback: ValueCallback<Array<Uri>>? = null

  private val filePickerLauncher: ActivityResultLauncher<Intent> =
      registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
          val data: Intent? = result.data
          val results: Array<Uri>? =
              when {
                data?.data != null -> arrayOf(data.data!!)
                data?.clipData != null -> {
                  val count = data.clipData!!.itemCount
                  Array(count) { i -> data.clipData!!.getItemAt(i).uri }
                }
                else -> null
              }
          filePathCallback?.onReceiveValue(results)
        } else {
          filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    onBackPressedDispatcher.addCallback(
        this,
        object : OnBackPressedCallback(true) {
          override fun handleOnBackPressed() {
            webView?.let { wv ->
              wv.evaluateJavascript(
                  "if (window.handleAndroidBack) { window.handleAndroidBack(); } else if (window.history.length > 1) { window.history.back(); } else { 'EXIT'; }"
              ) { value ->
                if (value == "\"EXIT\"" || value == null || value == "null") {
                  isEnabled = false
                  onBackPressedDispatcher.onBackPressed()
                }
              }
            } ?: run {
              isEnabled = false
              onBackPressedDispatcher.onBackPressed()
            }
          }
        })

    rootContainer = FrameLayout(this).apply {
      layoutParams = ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
      )
      ViewCompat.setOnApplyWindowInsetsListener(this) { view, insets ->
        val statusBarInset = insets.getInsets(WindowInsetsCompat.Type.statusBars())
        val navBarInset = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
        view.setPadding(0, statusBarInset.top, 0, navBarInset.bottom)
        insets
      }
    }

    val wv = createAndAttachWebView()
    webView = wv
    rootContainer?.addView(wv)
    setContentView(rootContainer)
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun createAndAttachWebView(): WebView {
    val wv = WebView(this).apply {
      layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
      )
      setBackgroundColor(0xFFF8FAFC.toInt())

      settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        databaseEnabled = true
        allowFileAccess = true
        allowContentAccess = true
        useWideViewPort = true
        loadWithOverviewMode = true
        builtInZoomControls = false
        displayZoomControls = false
        cacheMode = WebSettings.LOAD_DEFAULT
        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
      }

      addJavascriptInterface(AndroidNativeBridge(this@MainActivity, this), "AndroidBridge")

      webViewClient =
          object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
              val url = request?.url?.toString() ?: return false
              return handleExternalUrl(url)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
              if (url == null) return false
              return handleExternalUrl(url)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
              Log.w("LiftDeskWeb", "Resource load error on ${request?.url}: ${error?.description}")
              super.onReceivedError(view, request, error)
            }

            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?
            ): Boolean {
              Log.e("LiftDeskWeb", "Render process gone (crash=${detail?.didCrash()}). Recovering WebView...")
              view?.let { deadView ->
                rootContainer?.removeView(deadView)
                deadView.destroy()
              }
              webView = null
              rootContainer?.post {
                val newWv = createAndAttachWebView()
                webView = newWv
                rootContainer?.addView(newWv)
              }
              return true
            }
          }

      webChromeClient =
          object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
              Log.d("LiftDeskWeb", "${consoleMessage?.message()} (${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()})")
              return true
            }

            override fun onShowFileChooser(
                wv: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
              this@MainActivity.filePathCallback?.onReceiveValue(null)
              this@MainActivity.filePathCallback = filePathCallback

              val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                addCategory(Intent.CATEGORY_OPENABLE)
              }
              try {
                filePickerLauncher.launch(intent)
              } catch (e: Exception) {
                this@MainActivity.filePathCallback = null
                return false
              }
              return true
            }
          }

      loadUrl("file:///android_asset/index.html")
    }
    return wv
  }

  private fun handleExternalUrl(url: String): Boolean {
    return try {
      when {
        url.startsWith("https://wa.me/") || url.startsWith("whatsapp://") || url.contains("api.whatsapp.com") -> {
          val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
          intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
          startActivity(intent)
          true
        }
        url.startsWith("tel:") -> {
          val intent = Intent(Intent.ACTION_DIAL, Uri.parse(url))
          startActivity(intent)
          true
        }
        url.startsWith("mailto:") -> {
          val intent = Intent(Intent.ACTION_SENDTO, Uri.parse(url))
          startActivity(intent)
          true
        }
        url.startsWith("http://") || url.startsWith("https://") -> {
          val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
          startActivity(intent)
          true
        }
        else -> false
      }
    } catch (e: Exception) {
      Toast.makeText(this, "Could not open link: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
      false
    }
  }

  override fun onDestroy() {
    webView?.destroy()
    webView = null
    super.onDestroy()
  }

  class AndroidNativeBridge(private val activity: Activity, private val webView: WebView) {

    @JavascriptInterface
    fun isNative(): Boolean = true

    @JavascriptInterface
    fun printDocument(title: String?) {
      activity.runOnUiThread {
        try {
          val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
          val jobName = title?.takeIf { it.isNotBlank() } ?: "MPF_LiftDesk_Document"
          val printAdapter = webView.createPrintDocumentAdapter(jobName)
          val builder = PrintAttributes.Builder()
          builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4)
          printManager?.print(jobName, printAdapter, builder.build())
        } catch (e: Exception) {
          Toast.makeText(activity, "Print error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
      }
    }

    @JavascriptInterface
    fun openWhatsApp(phoneNumber: String, message: String) {
      activity.runOnUiThread {
        try {
          val cleanPhone = phoneNumber.replace("[^0-9+]".toRegex(), "")
          val formattedPhone = if (cleanPhone.startsWith("+")) {
            cleanPhone.substring(1)
          } else if (cleanPhone.length == 10) {
            "91$cleanPhone" // Default India country code if 10 digits
          } else {
            cleanPhone
          }

          val encodedMsg = Uri.encode(message)
          val uri = Uri.parse("https://api.whatsapp.com/send?phone=$formattedPhone&text=$encodedMsg")
          val intent = Intent(Intent.ACTION_VIEW, uri)
          intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
          activity.startActivity(intent)
        } catch (e: Exception) {
          Toast.makeText(activity, "WhatsApp error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
      }
    }

    @JavascriptInterface
    fun shareText(title: String, text: String) {
      activity.runOnUiThread {
        try {
          val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TEXT, text)
          }
          activity.startActivity(Intent.createChooser(intent, title))
        } catch (e: Exception) {
          Toast.makeText(activity, "Share error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
      }
    }

    @JavascriptInterface
    fun showToast(msg: String) {
      activity.runOnUiThread {
        Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show()
      }
    }
  }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
  Text(text = "Hello $name!", modifier = modifier)
}

@Preview(showBackground = true)
@Composable
fun GreetingPreview() {
  MyApplicationTheme { Greeting("Android") }
}
