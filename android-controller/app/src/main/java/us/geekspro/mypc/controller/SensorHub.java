package us.geekspro.mypc.controller;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import java.util.Locale;

/**
 * Native motion samples for the Game controller page, in place of the browser's devicemotion events.
 *
 * Why: Chrome delivers devicemotion at about 60 Hz, stamped when JavaScript gets it (jitter of a frame or more), and stops
 * when the page is busy or the screen dims; short moves (a 30 ms side jerk, the 160 ms free fall of a jump) are then missed.
 * Here the accelerometer, the fused linear acceleration and the gyroscope are read at 200 Hz on their own thread, combined
 * into one sample every ~10 ms (100 Hz) carrying the sensor's own timestamp, and handed to the page in small batches.
 *
 * A sample is what the page's motion engine expects from a devicemotion event (js/core/motion.js):
 *   [t ms, ax ay az (m/s², no gravity; null without a linear-acceleration sensor), gx gy gz (with gravity),
 *    alpha beta gamma (deg/s: around z, x, y, as Chrome reports rotationRate; null without a gyroscope)]
 * A batch is { n: when it left, s: [samples] }; t and n are on the sensor clock (elapsedRealtime, ms), which the page maps
 * onto its own (assets/bridge.js) so batches arriving late do not add jitter.
 */
final class SensorHub implements SensorEventListener {
    interface Sink { void batch(String json); }

    private static final int PERIOD_US = 5000;            // ask the sensors for 200 Hz
    private static final long EMIT_NS = 9_500_000L;       // one combined sample about every 10 ms
    private static final long FLUSH_MS = 16;               // batches to the page about 60 times a second
    private static final float RAD2DEG = (float) (180.0 / Math.PI);

    private final SensorManager sm;
    private final Sensor acc, lin, gyro;
    private final Sink sink;
    private HandlerThread thread;
    private Handler handler;
    private boolean on;

    private final float[] linV = new float[3], gyroV = new float[3];
    private long linAt, gyroAt, lastEmit;
    private final StringBuilder buf = new StringBuilder(2048);
    private final long[] pendT = new long[64];
    private final float[][] pend = new float[64][9];
    private int pendN;

    SensorHub(Context ctx, Sink sink) {
        this.sink = sink;
        sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        lin = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
        gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
    }

    boolean hasMotion() { return acc != null; }
    boolean hasLinear() { return lin != null; }
    boolean hasGyro() { return gyro != null; }

    synchronized void start() {
        if (on || acc == null) return;
        on = true;
        thread = new HandlerThread("mypc-sensors", android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY);
        thread.start();
        handler = new Handler(thread.getLooper());
        linAt = gyroAt = lastEmit = 0; pendN = 0;
        sm.registerListener(this, acc, PERIOD_US, 0, handler);
        if (lin != null) sm.registerListener(this, lin, PERIOD_US, 0, handler);
        if (gyro != null) sm.registerListener(this, gyro, PERIOD_US, 0, handler);
        handler.postDelayed(flusher, FLUSH_MS);
    }

    synchronized void stop() {
        if (!on) return;
        on = false;
        sm.unregisterListener(this);
        handler.removeCallbacksAndMessages(null);
        thread.quitSafely();
        thread = null; handler = null; pendN = 0;
    }

    /* runs on the sensor thread */
    @Override public void onSensorChanged(SensorEvent e) {
        float[] v = e.values;
        int type = e.sensor.getType();
        if (type == Sensor.TYPE_LINEAR_ACCELERATION) { linV[0] = v[0]; linV[1] = v[1]; linV[2] = v[2]; linAt = e.timestamp; return; }
        if (type == Sensor.TYPE_GYROSCOPE) { gyroV[0] = v[0]; gyroV[1] = v[1]; gyroV[2] = v[2]; gyroAt = e.timestamp; return; }
        if (type != Sensor.TYPE_ACCELEROMETER || e.timestamp - lastEmit < EMIT_NS) return;
        lastEmit = e.timestamp;
        if (pendN == pend.length) return;                  // the page is not keeping up: drop rather than grow
        float[] s = pend[pendN];
        // a reading older than 100 ms is stale (sensor stopped): send it as missing rather than frozen
        boolean hasLin = linAt != 0 && e.timestamp - linAt < 100_000_000L, hasGyro = gyroAt != 0 && e.timestamp - gyroAt < 100_000_000L;
        s[0] = hasLin ? linV[0] : Float.NaN; s[1] = hasLin ? linV[1] : Float.NaN; s[2] = hasLin ? linV[2] : Float.NaN;
        s[3] = v[0]; s[4] = v[1]; s[5] = v[2];
        s[6] = hasGyro ? gyroV[2] * RAD2DEG : Float.NaN; s[7] = hasGyro ? gyroV[0] * RAD2DEG : Float.NaN; s[8] = hasGyro ? gyroV[1] * RAD2DEG : Float.NaN;
        pendT[pendN++] = e.timestamp;
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private final Runnable flusher = new Runnable() {
        @Override public void run() {
            if (!on) return;
            if (pendN > 0) {
                long now = SystemClock.elapsedRealtimeNanos();     // the same clock as SensorEvent.timestamp
                buf.setLength(0);
                buf.append("{\"n\":").append(now / 100_000L / 10.0).append(",\"s\":[");
                for (int i = 0; i < pendN; i++) {
                    if (i > 0) buf.append(',');
                    buf.append('[').append(pendT[i] / 100_000L / 10.0);
                    float[] s = pend[i];
                    for (int k = 0; k < 9; k++) {
                        buf.append(',');
                        if (Float.isNaN(s[k])) buf.append("null");
                        else buf.append(String.format(Locale.ROOT, "%.3f", s[k]));
                    }
                    buf.append(']');
                }
                buf.append("]}");
                pendN = 0;
                sink.batch(buf.toString());
            }
            if (handler != null) handler.postDelayed(this, FLUSH_MS);
        }
    };
}
