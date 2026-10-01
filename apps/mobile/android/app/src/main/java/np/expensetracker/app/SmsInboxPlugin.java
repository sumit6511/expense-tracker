package np.expensetracker.app;

import android.Manifest;
import android.database.Cursor;
import android.provider.Telephony;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Reads SMS messages from the phone's inbox, so bank and wallet alerts can be imported without
 * copying them by hand. It only reads (never sends or deletes), and only when asked from the
 * app's import screen, after Android has asked the person for permission.
 *
 * read({ since?: number (ms), limit?: number }) => { messages: [{ id, sender, body, date }] }
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }) }
)
public class SmsInboxPlugin extends Plugin {

    private static final int MAX_MESSAGES = 1000;

    @PluginMethod
    public void read(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        readMessages(call);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            readMessages(call);
        } else {
            call.reject("Permission to read SMS messages was not given", "PERMISSION_DENIED");
        }
    }

    private void readMessages(PluginCall call) {
        long since = call.getLong("since", 0L);
        int limit = Math.max(1, Math.min(call.getInt("limit", 300), MAX_MESSAGES));
        String[] projection = {
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE
        };
        String selection = Telephony.Sms.DATE + " > ?";
        String[] args = { String.valueOf(since) };
        String order = Telephony.Sms.DATE + " DESC";

        JSArray messages = new JSArray();
        try (
            Cursor cursor = getContext()
                .getContentResolver()
                .query(Telephony.Sms.Inbox.CONTENT_URI, projection, selection, args, order)
        ) {
            if (cursor != null) {
                while (cursor.moveToNext() && messages.length() < limit) {
                    JSObject message = new JSObject();
                    message.put("id", cursor.getString(0));
                    message.put("sender", cursor.getString(1));
                    message.put("body", cursor.getString(2));
                    message.put("date", cursor.getLong(3));
                    messages.put(message);
                }
            }
        } catch (SecurityException e) {
            call.reject("Permission to read SMS messages was not given", "PERMISSION_DENIED");
            return;
        }

        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }
}
