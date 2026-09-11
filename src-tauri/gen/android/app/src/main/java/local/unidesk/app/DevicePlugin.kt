package local.unidesk.app

import android.app.Activity
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.json.JSONArray
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg class SecretArgs { lateinit var name: String; lateinit var action: String; var value: String? = null }
@InvokeArg class DocumentPickerArgs { var multiple: Boolean = true }
@InvokeArg class DocumentArgs { lateinit var source: String }
@InvokeArg class OpenArgs { lateinit var path: String; var share: Boolean = false }
@InvokeArg class UrlArgs { lateinit var url: String }

@TauriPlugin
class DevicePlugin(private val activity: Activity): Plugin(activity) {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("UniDeskVault", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("UniDeskVault", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    override fun load(webView: WebView) {
        (activity as? ComponentActivity)?.onBackPressedDispatcher?.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("Boolean(window.unideskAndroidBack && window.unideskAndroidBack())") { handled ->
                    if (handled != "true") activity.moveTaskToBack(true)
                }
            }
        })
    }
    @Command fun secret(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretArgs::class.java)
            val prefs = activity.getSharedPreferences("unidesk-vault", Activity.MODE_PRIVATE)
            val result = JSObject()
            synchronized(this) {
                when (args.action) {
                    "save" -> {
                        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
                        val encrypted = cipher.doFinal(requireNotNull(args.value).toByteArray(Charsets.UTF_8))
                        check(prefs.edit().putString(args.name, Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit())
                    }
                    "remove" -> check(prefs.edit().remove(args.name).commit())
                    else -> prefs.getString(args.name, null)?.let {
                        val bytes = Base64.decode(it, Base64.NO_WRAP)
                        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
                        result.put("value", String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
                    }
                }
            }
            invoke.resolve(result)
        } catch (_: Exception) { invoke.reject("Could not access Android secure storage. Reconnect this device.") }
    }
    @Command fun pickDocuments(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(DocumentPickerArgs::class.java)
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, args.multiple)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivityForResult(invoke, intent, "documentsResult")
        } catch (_: Exception) { invoke.reject("Could not open the document picker.") }
    }
    @ActivityCallback fun documentsResult(invoke: Invoke, result: ActivityResult) {
        val sources = JSONArray()
        if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            val clips = data?.clipData
            if (clips != null) for (index in 0 until clips.itemCount) sources.put(clips.getItemAt(index).uri.toString())
            else data?.data?.let { sources.put(it.toString()) }
        }
        invoke.resolve(JSObject().put("sources", sources))
    }
    @Command fun stageDocument(invoke: Invoke) {
        var target: File? = null
        try {
            val uri = Uri.parse(invoke.parseArgs(DocumentArgs::class.java).source)
            require(uri.scheme == "content")
            var name = "document"
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0) ?: name
            }
            name = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim('.',' ').take(180)
            require(name.isNotEmpty())
            val directory = File(activity.cacheDir, "imports/${UUID.randomUUID()}").apply { mkdirs() }
            target = File(directory, name)
            activity.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input)
                target.outputStream().use { output ->
                    val buffer = ByteArray(65536); var size = 0L
                    while (true) { val count = input.read(buffer); if (count < 0) break; size += count; require(size <= 100_000_000); output.write(buffer, 0, count) }
                }
            }
            invoke.resolve(JSObject().put("path", target.absolutePath))
        } catch (_: Exception) { target?.delete(); invoke.reject("Could not import this document. Choose a local file smaller than 100 MB.") }
    }
    @Command fun openFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenArgs::class.java)
            val file = File(args.path).canonicalFile
            require(file.isFile && (file.path.startsWith(activity.filesDir.canonicalPath + File.separator) || file.path.startsWith(activity.cacheDir.canonicalPath + File.separator)))
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
            val intent = if (args.share) Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri) else Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(Intent.createChooser(intent, if (args.share) "Share file" else "Open file"))
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("No application could open this local file.") }
    }
    @Command fun openUrl(invoke: Invoke) {
        try {
            val uri = Uri.parse(invoke.parseArgs(UrlArgs::class.java).url)
            require(uri.scheme == "https")
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("Could not open this link.") }
    }
    @Command fun exportFile(invoke: Invoke) {
        try {
            val file = File(invoke.parseArgs(OpenArgs::class.java).path).canonicalFile
            require(file.isFile && file.path.startsWith(activity.filesDir.canonicalPath + File.separator))
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, file.name)
            startActivityForResult(invoke, intent, "exportResult")
        } catch (_: Exception) { invoke.reject("Could not export this file.") }
    }
    @ActivityCallback fun exportResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) { invoke.resolve(); return }
        try {
            val file = File(invoke.parseArgs(OpenArgs::class.java).path).canonicalFile
            require(file.isFile && file.path.startsWith(activity.filesDir.canonicalPath + File.separator))
            val uri = requireNotNull(result.data?.data)
            activity.contentResolver.openOutputStream(uri, "wt").use { output -> requireNotNull(output); file.inputStream().use { it.copyTo(output) } }
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("Could not save the exported copy. The original file is unchanged.") }
    }
}
