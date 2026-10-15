package com.doomslug.listflow;
import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state){registerPlugin(ListFlowStoragePlugin.class);storeIntent(getIntent());super.onCreate(state);}
 @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);storeIntent(intent);if(bridge!=null)bridge.triggerWindowJSEvent("listflow-native-launch");}
 private void storeIntent(Intent intent){if(intent==null)return;SharedPreferences.Editor e=getSharedPreferences("launch",Context.MODE_PRIVATE).edit();if(Intent.ACTION_SEND.equals(intent.getAction())){String text=intent.getStringExtra(Intent.EXTRA_TEXT);if(text!=null)e.putString("text",text);}Uri uri=intent.getData();if(uri!=null&&"listflow".equals(uri.getScheme())){if("item".equals(uri.getHost()))e.putString("item",uri.getLastPathSegment());else e.putString("route",uri.getHost());}e.commit();}
}
