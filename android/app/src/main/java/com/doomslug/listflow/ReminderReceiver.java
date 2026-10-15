package com.doomslug.listflow;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
public class ReminderReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){String id=intent.getStringExtra("id"),title=intent.getStringExtra("title");if(id==null)return;Intent open=new Intent(context,MainActivity.class).setData(Uri.parse("listflow://item/"+id));PendingIntent action=PendingIntent.getActivity(context,id.hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(context,"reminders"):new Notification.Builder(context);Notification notification=builder.setSmallIcon(R.drawable.ic_reminder).setContentTitle(title).setContentText("A little nudge from ListFlow").setContentIntent(action).setAutoCancel(true).build();((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id,0,notification);}
}
