package us.geekspro.mypc.controller;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Runs while a controller is connected. A foreground service keeps the process (the page, its WebRTC link and the
 * sensors) at full priority, and a partial wake lock keeps the CPU and the sensors going, so a player can turn the screen
 * off in a motion mode (phone in the hand or in a pocket) without the link dropping.
 */
public final class LinkService extends Service {
    private static final String CHANNEL = "link";
    private PowerManager.WakeLock lock;

    static void set(Context ctx, boolean on) {
        Intent i = new Intent(ctx, LinkService.class);
        if (!on) { ctx.stopService(i); return; }
        try { ctx.startForegroundService(i); } catch (RuntimeException e) { /* not allowed right now: the screen-on flag still covers the common case */ }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.link_channel), NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher_fg)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.link_running))
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
            else startForeground(1, n);
        } catch (RuntimeException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (lock == null) {
            lock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mypc:controller");
            lock.setReferenceCounted(false);
            lock.acquire(4 * 60 * 60 * 1000L);              // a long game session at most; released when the link stops
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
