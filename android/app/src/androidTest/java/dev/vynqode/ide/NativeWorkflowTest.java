package dev.vynqode.ide;

import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeWorkflowTest {
    private String js(ActivityScenario<MainActivity> scenario, String source) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(source, value -> { result.set(value); latch.countDown(); }));
        assertTrue("WebView evaluation timed out", latch.await(20, TimeUnit.SECONDS));
        return result.get();
    }
    private void until(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long deadline=SystemClock.elapsedRealtime()+90000;
        while(SystemClock.elapsedRealtime()<deadline) {
            if("true".equals(js(scenario,expression)))return;
            SystemClock.sleep(250);
        }
        fail("Android workflow did not become ready: "+expression);
    }
    @Test public void localEditingRecoverySnapshotsNativeExportAndPreviewIsolation() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            until(scenario,"Boolean(window.Vynqode && window.VynqodeNative && window.VynqodeLibrary)");
            assertEquals("true",js(scenario,"window.VynqodeNative.available"));
            // Preserve the user's existing browser project/draft if run on a non-empty test device.
            js(scenario,"window.__backup={};for(const key of ['vynqode-project-v1','vynqode-undo-v1','vynqode-editor-draft-v1'])window.__backup[key]=localStorage.getItem(key);localStorage.setItem('vynqode-native-test-backup',JSON.stringify(window.__backup));true");
            try {
                js(scenario,"Vynqode.openProject({name:'Android instrumentation',files:{'index.html':'<html><body>Native workflow</body></html>','app.js':'const original=1;'}},'Native test');document.getElementById('codeEditor').value='<html><body>Recovered native draft</body></html>';document.getElementById('codeEditor').dispatchEvent(new Event('input'));true");
                until(scenario,"Boolean(localStorage.getItem('vynqode-editor-draft-v1'))");
                scenario.onActivity(activity -> activity.getBridge().getWebView().reload());
                until(scenario,"Boolean(window.Vynqode && document.getElementById('codeEditor').value.includes('Recovered native draft'))");
                js(scenario,"document.getElementById('saveFile').click();window.__saved=false;VynqodeLibrary.save(Vynqode.getProject()).then(id=>{window.__snapshotId=id;window.__saved=true;});true");
                until(scenario,"window.__saved===true");
                js(scenario,"window.__snapshotVerified=false;VynqodeLibrary.list().then(rows=>{window.__snapshotVerified=rows.some(r=>r.id===window.__snapshotId&&r.project.files['index.html'].includes('Recovered native draft'));});true");
                until(scenario,"window.__snapshotVerified===true");
                // Exercise bundled Monaco and its real language worker inside Android WebView.
                js(scenario,"document.querySelector('[data-file=\"app.js\"]').click();document.getElementById('toggleSmartEditor').click();true");
                until(scenario,"Boolean(window.VynqodeEditor && window.VynqodeEditor.enabled)");
                js(scenario,"const model=monaco.editor.getModels().find(model=>model.uri.path.endsWith('/app.js'));model.setValue('const nativeEdited=42;');Vynqode.save();window.__workerReady=false;monaco.languages.typescript.getJavaScriptWorker().then(factory=>factory(model.uri)).then(worker=>worker.getCompletionsAtPosition(model.uri.toString(),model.getValueLength(),{})).then(result=>window.__workerReady=Boolean(result&&result.entries.length));true");
                until(scenario,"window.__workerReady===true");
                assertEquals("true",js(scenario,"Vynqode.getProject().files['app.js'].includes('nativeEdited')"));
                js(scenario,"document.getElementById('toggleSmartEditor').click();true");
                // An opaque preview must not gain Java or Capacitor bridges.
                js(scenario,"window.__previewProbe=null;window.addEventListener('message',e=>{if(e.source===document.getElementById('previewFrame').contentWindow&&e.data.nativeProbe)window.__previewProbe=e.data.types;});document.getElementById('previewFrame').srcdoc='<script>parent.postMessage({nativeProbe:true,types:[typeof androidBridge,typeof CapacitorCookiesAndroidInterface,typeof CapacitorHttpAndroidInterface]},\"*\")<'+ '/script>';true");
                until(scenario,"Array.isArray(window.__previewProbe)");
                assertEquals("true",js(scenario,"window.__previewProbe.every(type=>type==='undefined')"));
                // Exercise the actual native filesystem and sharing plugins using a unique cache ZIP.
                String filename="native-contract-"+System.currentTimeMillis()+".zip";
                js(scenario,"window.__exportResult='pending';VynqodeNative.exportZip(new Blob([ArenaBrowserCore.zip(Vynqode.getProject())],{type:'application/zip'}),"+JSONObject.quote(filename)+").then(result=>window.__exportResult=result.cancelled?'cancelled':'done').catch(e=>window.__exportResult=String(e.message));true");
                File cache=InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
                File exported=new File(cache,"exports/"+filename);
                long deadline=SystemClock.elapsedRealtime()+30000;
                while(!exported.exists()&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(250);
                assertTrue("Native bridge did not create the exported ZIP",exported.exists());
                try(FileInputStream input=new FileInputStream(exported)){assertEquals('P',input.read());assertEquals('K',input.read());}
                // Close the Android chooser without sharing test source with another application.
                SystemClock.sleep(1000);
                try(ParcelFileDescriptor descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("input keyevent 4")) { }
                until(scenario,"window.__exportResult!=='pending'");
                assertEquals("\"cancelled\"",js(scenario,"window.__exportResult"));
                assertTrue(exported.delete());
            } finally {
                js(scenario,"if(window.__snapshotId)VynqodeLibrary.remove(window.__snapshotId);const backup=JSON.parse(localStorage.getItem('vynqode-native-test-backup')||'{}');for(const [key,value]of Object.entries(backup)){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}localStorage.removeItem('vynqode-native-test-backup');true");
            }
        }
    }
}
