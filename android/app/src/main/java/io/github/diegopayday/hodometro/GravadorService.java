package io.github.diegopayday.hodometro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Grava o pedal com a tela apagada e o celular no bolso.
 *
 * Serviço em primeiro plano do tipo "location": o Android não fecha o app
 * enquanto ele roda e mantém o GPS ligado. A trava de CPU (PARTIAL_WAKE_LOCK)
 * deixa o processador acordado para ler o GPS com a tela apagada. A notificação
 * fica na tela de bloqueio com distância, tempo em movimento e velocidade, que
 * o app manda a cada leitura.
 *
 * Cada leitura também vai para um arquivo. Se o app for fechado no meio do
 * pedal, o serviço continua gravando e o app recupera as leituras ao abrir.
 */
public class GravadorService extends Service implements LeitorGnss.Ouvinte {

    static final String CANAL = "pedal_ao_vivo";
    static final int ID_NOTIFICACAO = 4120;
    private static final String PREFS = "gravador";
    private static final String EXTRA_NOVO = "novo";
    private static final String EXTRA_TITULO = "titulo";
    private static final String EXTRA_TEXTO = "texto";
    private static final long HORAS_12 = 12L * 60 * 60 * 1000;

    /** Quem recebe as leituras enquanto o app está aberto (o plugin). */
    static volatile LeitorGnss.Ouvinte ouvinte;
    /** O serviço em execução, ou null. */
    static volatile GravadorService atual;

    private LeitorGnss leitor;
    private PowerManager.WakeLock trava;
    private NotificationManager notificacoes;
    private BufferedWriter diario;
    private String titulo = "Gravando o pedal";
    private String texto = "Procurando o sinal do GPS.";
    private long ultimoDoApp = 0;
    private boolean avisouAppFechado = false;

    // ---------- comandos do app ----------

    static void iniciar(Context ctx, boolean novo, String titulo, String texto) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("gravando", true).commit();
        Intent i = new Intent(ctx, GravadorService.class)
            .putExtra(EXTRA_NOVO, novo)
            .putExtra(EXTRA_TITULO, titulo)
            .putExtra(EXTRA_TEXTO, texto);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void parar(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("gravando", false).commit();
        ctx.stopService(new Intent(ctx, GravadorService.class));
    }

    static void atualizar(String titulo, String texto) {
        GravadorService s = atual;
        if (s != null) s.mostrar(titulo, texto, true);
    }

    /** O app pediu para gravar e ainda não mandou parar. */
    static boolean gravando(Context ctx) {
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("gravando", false);
    }

    static File arquivo(Context ctx) {
        return new File(ctx.getFilesDir(), "pedal-leituras.csv");
    }

    // ---------- ciclo de vida ----------

    @Override
    public void onCreate() {
        super.onCreate();
        notificacoes = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        criarCanal(this);
        leitor = new LeitorGnss(this, this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null && !gravando(this)) {
            // O Android reabriu o serviço, mas o pedal já tinha terminado
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean novo = intent != null && intent.getBooleanExtra(EXTRA_NOVO, false);
        if (intent != null) {
            String t = intent.getStringExtra(EXTRA_TITULO);
            String x = intent.getStringExtra(EXTRA_TEXTO);
            if (t != null) titulo = t;
            if (x != null) texto = x;
        }
        ultimoDoApp = System.currentTimeMillis();
        avisouAppFechado = false;
        try {
            Notification n = montar();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(ID_NOTIFICACAO, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(ID_NOTIFICACAO, n);
            }
        } catch (Exception e) {
            // O Android não deixou (localização retirada ou início em segundo plano)
            stopSelf();
            return START_NOT_STICKY;
        }
        if (novo || diario == null) abrirDiario(novo);
        if (trava == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            trava = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Hodometro:gravacao");
            trava.setReferenceCounted(false);
        }
        trava.acquire(HORAS_12);
        try {
            leitor.ligar();
        } catch (SecurityException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        atual = this;
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (atual == this) atual = null;
        leitor.desligar();
        fecharDiario();
        if (trava != null && trava.isHeld()) trava.release();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------- leituras ----------

    @Override
    public void aoLer(Location local) {
        String linha = linha(local);
        escrever(linha);
        LeitorGnss.Ouvinte o = ouvinte;
        if (o != null) o.aoLer(local);
        // O app parou de mandar os números (foi fechado): avisa, sem parar de gravar
        if (!avisouAppFechado && System.currentTimeMillis() - ultimoDoApp > 30000) {
            avisouAppFechado = true;
            mostrar(titulo, "Gravando pelo GPS. Abra o app para atualizar os números.", false);
        }
    }

    @Override
    public void aoMudarSatelites(int usados, int vistos) {
        LeitorGnss.Ouvinte o = ouvinte;
        if (o != null) o.aoMudarSatelites(usados, vistos);
    }

    @Override
    public void aoMudarGps(boolean ligado) {
        if (!ligado) mostrar(titulo, "A localização do celular foi desligada. Ligue de novo para continuar gravando.", false);
        LeitorGnss.Ouvinte o = ouvinte;
        if (o != null) o.aoMudarGps(ligado);
    }

    /**
     * Hora da leitura no relógio do celular, o mesmo que o app usa. Vem da idade
     * da leitura (relógio contínuo do Android), que mantém o intervalo exato entre
     * uma leitura e outra mesmo se o relógio do GPS e o do celular não baterem.
     */
    static long hora(Location l) {
        long agora = System.currentTimeMillis();
        long nanos = l.getElapsedRealtimeNanos();
        if (nanos <= 0) return agora;
        long idade = (SystemClock.elapsedRealtimeNanos() - nanos) / 1000000L;
        return idade >= 0 && idade < 60000 ? agora - idade : agora;
    }

    /** t,lat,lon,acc,alt,altAcc,vel,velAcc,rumo (vazio quando o GPS não informa). */
    static String linha(Location l) {
        StringBuilder sb = new StringBuilder(96);
        sb.append(hora(l)).append(',').append(l.getLatitude()).append(',').append(l.getLongitude()).append(',');
        if (l.hasAccuracy()) sb.append(l.getAccuracy());
        sb.append(',');
        if (l.hasAltitude()) sb.append(l.getAltitude());
        sb.append(',');
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && l.hasVerticalAccuracy()) sb.append(l.getVerticalAccuracyMeters());
        sb.append(',');
        if (l.hasSpeed()) sb.append(l.getSpeed());
        sb.append(',');
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && l.hasSpeedAccuracy()) sb.append(l.getSpeedAccuracyMetersPerSecond());
        sb.append(',');
        if (l.hasBearing()) sb.append(l.getBearing());
        return sb.toString();
    }

    /** A mesma leitura no formato que o app recebe. */
    static JSObject json(String linha) {
        String[] c = linha.split(",", -1);
        if (c.length < 9) return null;
        try {
            JSObject o = new JSObject();
            o.put("t", Long.parseLong(c[0]));
            o.put("lat", Double.parseDouble(c[1]));
            o.put("lon", Double.parseDouble(c[2]));
            String[] nomes = { "acc", "alt", "altAcc", "vel", "velAcc", "rumo" };
            for (int i = 0; i < nomes.length; i++) {
                if (!c[i + 3].isEmpty()) o.put(nomes[i], Double.parseDouble(c[i + 3]));
            }
            return o;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Leituras guardadas no arquivo com hora depois de `desde` (ms). */
    static List<JSObject> lerDiario(Context ctx, long desde) {
        List<JSObject> lista = new ArrayList<>();
        File f = arquivo(ctx);
        if (!f.exists()) return lista;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String l;
            while ((l = r.readLine()) != null) {
                JSObject o = json(l);
                if (o != null && o.getLong("t") > desde) lista.add(o);
            }
        } catch (Exception e) {
            // arquivo cortado no meio: devolve o que deu para ler
        }
        return lista;
    }

    private void abrirDiario(boolean novo) {
        fecharDiario();
        try {
            diario = new BufferedWriter(new FileWriter(arquivo(this), !novo));
        } catch (IOException e) {
            diario = null;
        }
    }

    private void escrever(String linha) {
        if (diario == null) return;
        try {
            diario.write(linha);
            diario.newLine();
            diario.flush();
        } catch (IOException e) {
            // segue gravando sem o arquivo
        }
    }

    private void fecharDiario() {
        if (diario == null) return;
        try {
            diario.close();
        } catch (IOException e) {
            // nada a fazer
        }
        diario = null;
    }

    // ---------- notificação ----------

    static void criarCanal(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CANAL) != null) return;
        NotificationChannel c = new NotificationChannel(CANAL, "Pedal ao vivo", NotificationManager.IMPORTANCE_DEFAULT);
        c.setDescription("Distância, tempo em movimento e velocidade enquanto o pedal grava.");
        c.setSound(null, null);
        c.enableVibration(false);
        c.enableLights(false);
        c.setShowBadge(false);
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(c);
    }

    private void mostrar(String titulo, String texto, boolean doApp) {
        if (titulo != null) this.titulo = titulo;
        if (texto != null) this.texto = texto;
        if (doApp) {
            ultimoDoApp = System.currentTimeMillis();
            avisouAppFechado = false;
        }
        try {
            notificacoes.notify(ID_NOTIFICACAO, montar());
        } catch (Exception e) {
            // sem permissão de notificação: o serviço continua gravando
        }
    }

    @SuppressWarnings("deprecation")
    private Notification montar() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CANAL)
            : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_pedal)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(new Notification.BigTextStyle().bigText(texto))
            .setColor(0xFFFC5200)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(abrirApp());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) b.setPriority(Notification.PRIORITY_DEFAULT);
        return b.build();
    }

    private PendingIntent abrirApp() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, i, f);
    }
}
