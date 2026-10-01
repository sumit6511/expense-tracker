package np.expensetracker.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-specific plugins are registered before the bridge starts.
        registerPlugin(SmsInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
