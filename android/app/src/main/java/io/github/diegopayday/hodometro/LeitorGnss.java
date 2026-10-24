package io.github.diegopayday.hodometro;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

/**
 * Lê a posição direto do chip de GPS do aparelho (GNSS: GPS, Galileo, GLONASS,
 * BeiDou), sem Wi-Fi nem rede de celular. Funciona sem internet e sem sinal
 * de operadora. Também conta os satélites, para mostrar a qualidade do sinal.
 */
class LeitorGnss implements LocationListener {

    interface Ouvinte {
        void aoLer(Location local);
        void aoMudarSatelites(int usados, int vistos);
        void aoMudarGps(boolean ligado);
    }

    private final LocationManager gerente;
    private final Ouvinte ouvinte;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private GnssStatus.Callback satelites;
    private boolean ligado = false;
    int usados = -1;
    int vistos = -1;

    LeitorGnss(Context ctx, Ouvinte ouvinte) {
        this.gerente = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        this.ouvinte = ouvinte;
    }

    /** A localização do celular está ligada? */
    boolean gpsLigado() {
        try {
            return gerente != null && gerente.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    boolean ativo() {
        return ligado;
    }

    /** Uma leitura por segundo, sem filtro de distância. Chamar com a permissão de localização precisa. */
    @SuppressLint("MissingPermission")
    void ligar() {
        if (ligado || gerente == null) return;
        gerente.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
        ligado = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            satelites = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    int n = status.getSatelliteCount();
                    int u = 0;
                    for (int i = 0; i < n; i++) if (status.usedInFix(i)) u++;
                    if (u != usados || n != vistos) {
                        usados = u;
                        vistos = n;
                        ouvinte.aoMudarSatelites(u, n);
                    }
                }
            };
            try {
                gerente.registerGnssStatusCallback(satelites, principal);
            } catch (Exception e) {
                satelites = null;
            }
        }
    }

    void desligar() {
        if (gerente == null) return;
        if (ligado) {
            gerente.removeUpdates(this);
            ligado = false;
        }
        if (satelites != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            gerente.unregisterGnssStatusCallback(satelites);
            satelites = null;
        }
        usados = -1;
        vistos = -1;
    }

    @Override
    public void onLocationChanged(Location local) {
        ouvinte.aoLer(local);
    }

    @Override
    public void onProviderEnabled(String provedor) {
        ouvinte.aoMudarGps(true);
    }

    @Override
    public void onProviderDisabled(String provedor) {
        ouvinte.aoMudarGps(false);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(String provedor, int status, Bundle extras) {}
}
