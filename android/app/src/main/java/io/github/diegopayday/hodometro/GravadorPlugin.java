package io.github.diegopayday.hodometro;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.location.Location;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.view.WindowManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Ponte entre o app (JavaScript) e o GPS do aparelho.
 *
 * observar()      GPS ligado antes de sair, para mostrar o sinal (sem serviço)
 * iniciar()       grava em segundo plano com o GravadorService
 * parar()         termina a gravação (o arquivo de leituras fica até limpar())
 * leituras()      o que o serviço gravou enquanto o app estava fechado
 * atualizar()     números da notificação
 * bateria(), pedirBateriaLivre(), abrirAjustes(), vibrar(), manterTela()
 * arquivoRecebido() arquivo aberto com o app pelo WhatsApp ou pelo Drive (amigo, backup, GPX)
 *
 * Eventos: "leitura", "satelites", "gps" e "arquivo".
 */
@CapacitorPlugin(
    name = "Gravador",
    permissions = {
        @Permission(alias = "localizacao", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class GravadorPlugin extends Plugin implements LeitorGnss.Ouvinte {

    private LeitorGnss observador;
    /** Arquivo que chegou com o app já aberto e ainda não foi lido. */
    private Uri recebido;

    @Override
    public void load() {
        GravadorService.ouvinte = this;
        GravadorService.criarCanal(getContext());
        observador = new LeitorGnss(getContext(), this);
    }

    // ---------- GPS ----------

    @PluginMethod
    public void observar(PluginCall call) {
        if (getPermissionState("localizacao") != PermissionState.GRANTED) {
            requestPermissionForAlias("localizacao", call, "aposPermissao");
            return;
        }
        ligarObservador(call);
    }

    @PluginMethod
    public void pararObservar(PluginCall call) {
        observador.desligar();
        call.resolve();
    }

    @PluginMethod
    public void iniciar(PluginCall call) {
        if (getPermissionState("localizacao") != PermissionState.GRANTED) {
            requestPermissionForAlias("localizacao", call, "aposPermissao");
            return;
        }
        iniciarServico(call);
    }

    @PermissionCallback
    private void aposPermissao(PluginCall call) {
        if (getPermissionState("localizacao") != PermissionState.GRANTED) {
            call.reject("O app precisa da localização precisa para medir o pedal.", "SEM_PERMISSAO");
            return;
        }
        if ("iniciar".equals(call.getMethodName())) iniciarServico(call);
        else ligarObservador(call);
    }

    private void ligarObservador(PluginCall call) {
        if (!observador.gpsLigado()) {
            call.reject("A localização do celular está desligada.", "GPS_DESLIGADO");
            return;
        }
        if (GravadorService.atual != null) {
            // A gravação já está lendo o GPS
            call.resolve();
            return;
        }
        try {
            observador.ligar();
            call.resolve();
        } catch (SecurityException e) {
            call.reject("O app precisa da localização precisa para medir o pedal.", "SEM_PERMISSAO");
        }
    }

    private void iniciarServico(PluginCall call) {
        if (!observador.gpsLigado()) {
            call.reject("A localização do celular está desligada.", "GPS_DESLIGADO");
            return;
        }
        observador.desligar();
        try {
            GravadorService.iniciar(
                getContext(),
                Boolean.TRUE.equals(call.getBoolean("novo", false)),
                call.getString("titulo", "Gravando o pedal"),
                call.getString("texto", "Procurando o sinal do GPS.")
            );
            call.resolve();
        } catch (Exception e) {
            call.reject("O Android não deixou gravar em segundo plano: " + e.getMessage(), "SERVICO");
        }
    }

    @PluginMethod
    public void parar(PluginCall call) {
        GravadorService.parar(getContext());
        call.resolve();
    }

    @PluginMethod
    public void limpar(PluginCall call) {
        if (!GravadorService.gravando(getContext())) GravadorService.arquivo(getContext()).delete();
        call.resolve();
    }

    @PluginMethod
    public void atualizar(PluginCall call) {
        GravadorService.atualizar(call.getString("titulo"), call.getString("texto"));
        call.resolve();
    }

    @PluginMethod
    public void leituras(PluginCall call) {
        final long desde = numero(call, "desde");
        final Context ctx = getContext();
        execute(() -> {
            List<JSObject> lista = GravadorService.lerDiario(ctx, desde);
            JSObject r = new JSObject();
            r.put("leituras", new JSArray(lista));
            call.resolve(r);
        });
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("gravando", GravadorService.atual != null);
        r.put("gpsLigado", observador.gpsLigado());
        r.put("bateriaLivre", bateriaLivre());
        call.resolve(r);
    }

    // ---------- bateria e ajustes ----------

    @PluginMethod
    public void bateria(PluginCall call) {
        JSObject r = new JSObject();
        r.put("bateriaLivre", bateriaLivre());
        call.resolve(r);
    }

    /** Abre o pedido do Android para o app rodar sem restrição de bateria. */
    @PluginMethod
    public void pedirBateriaLivre(PluginCall call) {
        Activity a = getActivity();
        if (!bateriaLivre()) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + a.getPackageName()));
                a.startActivity(i);
            } catch (Exception e) {
                try {
                    a.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception e2) {
                    abrir(a, "app");
                }
            }
        }
        JSObject r = new JSObject();
        r.put("bateriaLivre", bateriaLivre());
        call.resolve(r);
    }

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        abrir(getActivity(), call.getString("tipo", "app"));
        call.resolve();
    }

    private void abrir(Activity a, String tipo) {
        Intent i;
        if ("localizacao".equals(tipo)) {
            i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        } else if ("notificacoes".equals(tipo) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", a.getPackageName(), null));
        }
        try {
            a.startActivity(i);
        } catch (Exception e) {
            try {
                a.startActivity(new Intent(Settings.ACTION_SETTINGS));
            } catch (Exception e2) {
                // sem tela de ajustes
            }
        }
    }

    private boolean bateriaLivre() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    // ---------- vibração e tela ----------

    /** padrao: [vibra, pausa, vibra, ...] em ms. Vibra mesmo com a tela apagada. */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void vibrar(PluginCall call) {
        JSArray arr = call.getArray("padrao", new JSArray());
        long[] p = new long[arr.length() + 1];
        for (int i = 0; i < arr.length(); i++) p[i + 1] = Math.max(0, Math.min(3000, arr.optLong(i, 0)));
        Vibrator v;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (v == null || !v.hasVibrator() || p.length < 2) {
            call.resolve();
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                v.vibrate(VibrationEffect.createWaveform(p, -1), VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(p, -1), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            } else {
                v.vibrate(p, -1);
            }
        } catch (Exception e) {
            // aparelho sem vibração
        }
        call.resolve();
    }

    /** Modo guidão: mantém a tela acesa enquanto o app está aberto. */
    @PluginMethod
    public void manterTela(PluginCall call) {
        final boolean ligada = Boolean.TRUE.equals(call.getBoolean("ligada", false));
        final Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (ligada) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // ---------- arquivo aberto com o app ----------

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Uri u = uriDe(intent);
        if (u != null) {
            recebido = u;
            notifyListeners("arquivo", new JSObject());
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri uriDe(Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return intent.getData();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return extra instanceof Uri ? (Uri) extra : null;
        }
        return null;
    }

    /**
     * Texto do arquivo aberto com o app: { texto, nome }. Vazio se não chegou
     * nada. Cada arquivo é entregue uma vez só.
     */
    @PluginMethod
    public void arquivoRecebido(PluginCall call) {
        Activity a = getActivity();
        Uri u = recebido;
        recebido = null;
        if (u == null && a != null) {
            u = uriDe(a.getIntent());
            if (u != null) a.setIntent(new Intent(Intent.ACTION_MAIN));
        }
        if (u == null) {
            call.resolve(new JSObject());
            return;
        }
        final Uri uri = u;
        final Context ctx = getContext();
        execute(() -> {
            try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("arquivo vazio");
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                long total = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > 20L * 1024 * 1024) throw new IOException("arquivo grande demais");
                    out.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("texto", new String(out.toByteArray(), StandardCharsets.UTF_8));
                r.put("nome", nomeDe(ctx, uri));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Não consegui abrir o arquivo: " + e.getMessage(), "ARQUIVO");
            }
        });
    }

    private static String nomeDe(Context ctx, Uri uri) {
        try (Cursor c = ctx.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String nome = c.getString(0);
                if (nome != null) return nome;
            }
        } catch (Exception e) {
            // sem nome
        }
        String s = uri.getLastPathSegment();
        return s != null ? s : "";
    }

    // ---------- eventos ----------

    @Override
    public void aoLer(Location local) {
        JSObject o = GravadorService.json(GravadorService.linha(local));
        if (o != null) notifyListeners("leitura", o);
    }

    @Override
    public void aoMudarSatelites(int usados, int vistos) {
        JSObject o = new JSObject();
        o.put("usados", usados);
        o.put("vistos", vistos);
        notifyListeners("satelites", o);
    }

    @Override
    public void aoMudarGps(boolean ligado) {
        JSObject o = new JSObject();
        o.put("ligado", ligado);
        notifyListeners("gps", o);
    }

    @Override
    protected void handleOnStop() {
        // Antes de começar o pedal o GPS só fica ligado com o app na tela
        observador.desligar();
        super.handleOnStop();
    }

    @Override
    protected void handleOnDestroy() {
        if (GravadorService.ouvinte == this) GravadorService.ouvinte = null;
        observador.desligar();
        super.handleOnDestroy();
    }

    private static long numero(PluginCall call, String nome) {
        Object v = call.getData().opt(nome);
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }
}
