package com.hertzforge.playlist;

import android.app.Activity;
import android.content.ContentValues;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Standalone shell for the Hertz Forge playlist app.
 *
 * The web app is bundled in assets/ and served over a loopback HTTP server on a
 * fixed port. That origin (http://127.0.0.1) is a trusted origin, which gives
 * the page a secure context: AudioWorklet, fetch() and localStorage all behave
 * exactly as they do on the hosted build, with no network access at runtime.
 * The port is fixed so the origin — and with it saved playlists — is stable
 * across launches.
 */
public class MainActivity extends Activity {

    private static final int BASE_PORT = 8765;
    private static final int PORT_TRIES = 20;

    private WebView web;
    private AssetServer server;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setBackgroundColor(0xFF0C0C18);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);

        try {
            server = new AssetServer(getAssets());
            server.start();
            web.loadUrl("http://127.0.0.1:" + server.port() + "/");
        } catch (IOException e) {
            Toast.makeText(this, "Could not start: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Lets the page save exports into the phone's Downloads folder. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            try {
                byte[] data = Base64.decode(base64, Base64.NO_WRAP);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE,
                        mime == null ? "application/octet-stream" : mime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri uri = getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("could not create download entry");

                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IOException("could not open download stream");
                    os.write(data);
                }

                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);

                toast("Saved " + name + " to Downloads");
            } catch (Exception e) {
                toast("Save failed: " + e.getMessage());
            }
        }

        private void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
        }
    }

    /** Minimal read-only HTTP/1.1 server over the packaged assets. */
    private static class AssetServer {
        private final AssetManager assets;
        private final ServerSocket socket;
        private final ExecutorService pool = Executors.newCachedThreadPool();
        private volatile boolean running = true;

        AssetServer(AssetManager assets) throws IOException {
            this.assets = assets;
            ServerSocket bound = null;
            IOException last = null;
            for (int i = 0; i < PORT_TRIES && bound == null; i++) {
                try {
                    bound = new ServerSocket(BASE_PORT + i, 64, InetAddress.getByName("127.0.0.1"));
                } catch (IOException e) {
                    last = e;
                }
            }
            if (bound == null) throw last == null ? new IOException("no free port") : last;
            this.socket = bound;
        }

        int port() {
            return socket.getLocalPort();
        }

        void start() {
            Thread t = new Thread(() -> {
                while (running) {
                    try {
                        Socket client = socket.accept();
                        pool.execute(() -> handle(client));
                    } catch (IOException e) {
                        if (running) {
                            /* transient accept failure — keep serving */
                        }
                    }
                }
            }, "hertz-assets");
            t.setDaemon(true);
            t.start();
        }

        void stop() {
            running = false;
            try {
                socket.close();
            } catch (IOException ignored) {
            }
            pool.shutdownNow();
        }

        private void handle(Socket client) {
            try (Socket c = client) {
                InputStream in = new BufferedInputStream(c.getInputStream());
                String requestLine = readLine(in);
                if (requestLine == null) return;

                String header;
                do {
                    header = readLine(in);
                } while (header != null && !header.isEmpty());

                String[] parts = requestLine.split(" ");
                if (parts.length < 2) return;

                String path = parts[1];
                int q = path.indexOf('?');
                if (q >= 0) path = path.substring(0, q);
                if (path.startsWith("/")) path = path.substring(1);
                if (path.isEmpty() || path.endsWith("/")) path = path + "index.html";

                byte[] body = readAsset(path);
                if (body == null) body = readAsset("index.html");
                if (body == null) {
                    respond(c, "404 Not Found", "text/plain", "not found".getBytes(StandardCharsets.UTF_8));
                    return;
                }
                respond(c, "200 OK", mimeType(path), body);
            } catch (IOException ignored) {
            }
        }

        private static String readLine(InputStream in) throws IOException {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            int b;
            while ((b = in.read()) != -1) {
                if (b == '\n') break;
                if (b != '\r') buf.write(b);
            }
            if (b == -1 && buf.size() == 0) return null;
            return buf.toString("UTF-8");
        }

        private byte[] readAsset(String path) {
            try (InputStream is = assets.open(path)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = is.read(chunk)) > 0) out.write(chunk, 0, n);
                return out.toByteArray();
            } catch (IOException e) {
                return null;
            }
        }

        private static void respond(Socket c, String status, String type, byte[] body)
                throws IOException {
            OutputStream out = c.getOutputStream();
            String head = "HTTP/1.1 " + status + "\r\n"
                    + "Content-Type: " + type + "\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(body);
            out.flush();
        }

        private static String mimeType(String path) {
            String p = path.toLowerCase();
            if (p.endsWith(".html")) return "text/html; charset=utf-8";
            if (p.endsWith(".css")) return "text/css; charset=utf-8";
            if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
            if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/manifest+json";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".svg")) return "image/svg+xml";
            return "application/octet-stream";
        }
    }
}
