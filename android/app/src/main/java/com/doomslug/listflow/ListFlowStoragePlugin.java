package com.doomslug.listflow;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import android.os.Build;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.ArrayList;

@CapacitorPlugin(name="ListFlowStorage",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class ListFlowStoragePlugin extends Plugin {
 private SQLiteOpenHelper helper;
 @Override public void load(){helper=new SQLiteOpenHelper(getContext(),"listflow.db",null,1){
  @Override public void onConfigure(SQLiteDatabase db){db.enableWriteAheadLogging();db.execSQL("PRAGMA synchronous=FULL");}
  @Override public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE checkpoint(id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL)");}
  @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){}
 };helper.getWritableDatabase();}
 @PluginMethod public void read(PluginCall call){try(Cursor c=helper.getReadableDatabase().rawQuery("SELECT state FROM checkpoint WHERE id=1",null)){JSObject result=new JSObject();if(c.moveToFirst())result.put("state",c.getString(0));call.resolve(result);}catch(Exception e){call.reject("Cannot read local SQLite checkpoint",e);}}
 @PluginMethod public void write(PluginCall call){String state=call.getString("state");if(state==null){call.reject("Missing state");return;}SQLiteDatabase db=helper.getWritableDatabase();db.beginTransaction();try{ContentValues values=new ContentValues();values.put("id",1);values.put("state",state);db.execSQL("INSERT OR REPLACE INTO checkpoint(id,state) VALUES(1,?)",new Object[]{state});db.setTransactionSuccessful();}catch(Exception e){call.reject("Cannot commit local checkpoint",e);return;}finally{db.endTransaction();}call.resolve();}
 @PluginMethod public void getLaunch(PluginCall call){android.content.SharedPreferences prefs=getContext().getSharedPreferences("launch",Context.MODE_PRIVATE);JSObject result=new JSObject();for(String key:new String[]{"text","route","item"})if(prefs.contains(key))result.put(key,prefs.getString(key,""));prefs.edit().clear().commit();call.resolve(result);}
 @PluginMethod public void dictate(PluginCall call){Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);intent.putExtra(RecognizerIntent.EXTRA_PROMPT,"Capture a thought");try{startActivityForResult(call,intent,"speechResult");}catch(Exception e){call.reject("No speech recognition app is installed",e);}}
 @ActivityCallback private void speechResult(PluginCall call,ActivityResult result){if(call==null)return;if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){call.reject("Voice capture cancelled");return;}ArrayList<String> text=result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);if(text==null||text.isEmpty()){call.reject("No speech detected");return;}JSObject data=new JSObject();data.put("text",text.get(0));call.resolve(data);}
 @PluginMethod public void remind(PluginCall call){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"notificationPermission");return;}schedule(call);}
 @PermissionCallback private void notificationPermission(PluginCall call){if(getPermissionState("notifications")!=PermissionState.GRANTED){call.reject("Notification permission was denied");return;}schedule(call);}
 private void schedule(PluginCall call){String id=call.getString("id"),title=call.getString("title");Long at=call.getLong("at");if(id==null||title==null||at==null||at<=System.currentTimeMillis()){call.reject("Choose a future due date");return;}NotificationManager nm=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel("reminders","ListFlow reminders",NotificationManager.IMPORTANCE_DEFAULT));Intent intent=new Intent(getContext(),ReminderReceiver.class).setData(android.net.Uri.parse("listflow-reminder://item/"+id)).putExtra("id",id).putExtra("title",title);PendingIntent pending=PendingIntent.getBroadcast(getContext(),id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);AlarmManager alarm=(AlarmManager)getContext().getSystemService(Context.ALARM_SERVICE);alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);JSObject result=new JSObject();result.put("scheduled",true);call.resolve(result);}
}
