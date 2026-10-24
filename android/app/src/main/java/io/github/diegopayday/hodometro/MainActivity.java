package io.github.diegopayday.hodometro;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin do próprio app: GPS em segundo plano, notificação ao vivo, bateria e vibração
        registerPlugin(GravadorPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Voltar fecha o resumo ou os ajustes do app. Na tela principal, manda o app
     * para segundo plano em vez de fechar, para não interromper um pedal.
     */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        WebView wv = bridge != null ? bridge.getWebView() : null;
        if (wv != null && wv.canGoBack()) wv.goBack();
        else moveTaskToBack(true);
    }
}
