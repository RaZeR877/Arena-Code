package dev.vynqode.ide.nativebridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;
import android.widget.Toast;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name="VynqodeDevice")
public final class VynqodeNativePlugin extends Plugin {
    private final ExecutorService io=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(8));
    private CredentialVault vault;
    private FolderProjects folders;
    @Override public void load(){vault=new CredentialVault(getContext());folders=new FolderProjects(getContext());}
    private interface Task{JSONObject run()throws Exception;}
    private void execute(PluginCall call,Task task){try{io.execute(()->{try{call.resolve(new JSObject(task.run().toString()));}catch(Exception error){String message=(error instanceof IllegalArgumentException||error instanceof IllegalStateException)?error.getMessage():"Native operation failed. Check permissions, network and provider settings.";call.reject(message==null?"Native operation failed":message);}});}catch(RejectedExecutionException error){call.reject("Native operations are busy. Try again shortly.");}}
    private JSONObject providers()throws Exception{
        JSONArray result=new JSONArray();
        for(Map.Entry<String,String[]> item:ProviderClient.DEFAULTS.entrySet()){
            JSONObject config=null;boolean unavailable=false;try{config=vault.read(item.getKey());}catch(Exception error){unavailable=true;}
            result.put(new JSONObject().put("id",item.getKey()).put("name",item.getValue()[0]).put("configured",config!=null).put("credentialUnavailable",unavailable).put("native",true)
                .put("models",config==null?ProviderClient.models(item.getValue()[2]):config.getJSONArray("models")));
        }return new JSONObject().put("providers",result);
    }
    @PluginMethod public void providers(PluginCall call){execute(call,()->providers());}
    @PluginMethod public void configure(PluginCall call){
        String provider=call.getString("provider");
        if(provider==null||!provider.equals("github")&&!ProviderClient.DEFAULTS.containsKey(provider)){call.reject("Unknown provider");return;}
        try{io.execute(()->{
            JSONObject existing=null;try{existing=vault.read(provider);}catch(Exception ignored){}
            final JSONObject previous=existing;
            getActivity().runOnUiThread(()->showConfiguration(call,provider,previous));
        });}catch(RejectedExecutionException error){call.reject("Native operations are busy. Try again shortly.");}
    }
    private void showConfiguration(PluginCall call,String provider,JSONObject previous){
        boolean github=provider.equals("github"),ollama=provider.equals("ollama"),custom=provider.equals("custom");
        LinearLayout layout=new LinearLayout(getContext());layout.setOrientation(LinearLayout.VERTICAL);int pad=(int)(20*getContext().getResources().getDisplayMetrics().density);layout.setPadding(pad,pad,pad,pad);
        TextView explanation=new TextView(getContext());explanation.setText(github?"GitHub credentials stay encrypted by Android Keystore. Public cloning needs no token. A push needs your explicit approval.":"Credentials stay encrypted on this device, outside page JavaScript. Configuration makes no API call. Provider requests may be billed; device-local Ollama has no API bill.");layout.addView(explanation);
        EditText endpoint=new EditText(getContext());endpoint.setSingleLine();endpoint.setHint("HTTPS chat/completions endpoint");
        if(custom||ollama){endpoint.setText(previous==null?ProviderClient.DEFAULTS.get(provider)[1]:previous.optString("endpoint"));layout.addView(endpoint);}
        EditText models=new EditText(getContext());models.setHint("Allowed model IDs, comma separated");
        if(!github){JSONArray list=previous==null?null:previous.optJSONArray("models");StringBuilder text=new StringBuilder();if(list!=null)for(int i=0;i<list.length();i++){if(i>0)text.append(',');text.append(list.optString(i));}models.setText(list==null?ProviderClient.DEFAULTS.get(provider)[2]:text.toString());layout.addView(models);}
        EditText key=new EditText(getContext());key.setSingleLine();key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);key.setHint(previous==null?"Provider key / token":"Leave blank to keep saved key");
        if(Build.VERSION.SDK_INT>=26)key.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if(!ollama)layout.addView(key);
        ScrollView scroll=new ScrollView(getContext());scroll.addView(layout);
        AlertDialog dialog=new AlertDialog.Builder(getContext()).setTitle(github?"GitHub access":ProviderClient.DEFAULTS.get(provider)[0]).setView(scroll).setPositiveButton("Save securely",null).setNegativeButton("Cancel",(d,w)->{key.setText("");call.reject("Configuration cancelled");}).create();
        dialog.setOnCancelListener(d->{key.setText("");call.reject("Configuration cancelled");});
        dialog.setOnShowListener(d->{dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            try{
                String secret=key.getText().toString();if(secret.isEmpty()&&previous!=null)secret=previous.optString("key");
                if(!ollama&&(!secret.matches("[\\x21-\\x7e]{8,512}"))){key.setError("Enter a valid credential");return;}
                JSONObject record=new JSONObject().put("key",secret);
                if(!github){record.put("models",ProviderClient.models(models.getText().toString()));record.put("endpoint",ProviderClient.endpoint(provider,endpoint.getText().toString()).toString());}
                final JSONObject saved=record;key.setText("");dialog.dismiss();execute(call,()->{vault.save(provider,saved);return new JSONObject().put("configured",true);});
            }catch(Exception error){Toast.makeText(getContext(),"Check the endpoint, model list and credential.",Toast.LENGTH_LONG).show();}
        });});dialog.show();
    }
    @PluginMethod public void clear(PluginCall call){execute(call,()->{String id=call.getString("provider");if(id==null||!id.equals("github")&&!ProviderClient.DEFAULTS.containsKey(id))throw new IllegalArgumentException("Unknown provider");vault.remove(id);return new JSONObject().put("removed",true);});}
    @PluginMethod public void complete(PluginCall call){execute(call,()->{
        if(!Boolean.TRUE.equals(call.getBoolean("approved")))throw new IllegalArgumentException("Explicit request approval is required");
        String provider=call.getString("provider");if(!ProviderClient.DEFAULTS.containsKey(provider))throw new IllegalArgumentException("Unknown provider");
        JSONObject config=vault.read(provider);if(config==null)throw new IllegalStateException("Configure this provider first");
        return ProviderClient.complete(provider,config,call.getString("model"),call.getArray("messages"),new ProviderClient.Network());
    });}
    @PluginMethod public void openCompanion(PluginCall call){getActivity().runOnUiThread(()->new AlertDialog.Builder(getContext()).setTitle("Open computer companion?").setMessage("This opens http://127.0.0.1:3000 in your browser. It requires a trusted USB computer running Vynqode and adb reverse. Terminal commands execute on that computer; project changes transfer only through explicit ZIP export/import.").setPositiveButton("Open browser",(dialog,which)->{try{Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse("http://127.0.0.1:3000"));getActivity().startActivity(intent);call.resolve(new JSObject().put("opened",true));}catch(Exception error){call.reject("No browser could open the localhost companion");}}).setNegativeButton("Cancel",(d,w)->call.reject("Companion cancelled")).setOnCancelListener(d->call.reject("Companion cancelled")).show());}
    @PluginMethod public void chooseFolder(PluginCall call){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);startActivityForResult(call,intent,"folderSelected");}
    @ActivityCallback private void folderSelected(PluginCall call,ActivityResult result){
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.reject("Folder selection cancelled");return;}
        Uri uri=result.getData().getData();int flags=result.getData().getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        execute(call,()->{getContext().getContentResolver().takePersistableUriPermission(uri,flags);return folders.open(uri);});
    }
    @PluginMethod public void reopenFolder(PluginCall call){execute(call,()->folders.reopen());}
    @PluginMethod public void saveFolder(PluginCall call){
        JSObject files=call.getObject("files");String id=call.getString("id");
        try{io.execute(()->{
            try{
                JSONArray removed=folders.removedPaths(id,files);
                if(removed.length()==0){execute(call,()->folders.save(id,files,false));return;}
                getActivity().runOnUiThread(()->new AlertDialog.Builder(getContext()).setTitle("Delete "+removed.length()+" device files?")
                    .setMessage("Your editor removed these managed files: "+removed.toString()+". Changed files will also be saved. A private recovery copy is retained; external changes cause a conflict.")
                    .setPositiveButton("Save and delete",(dialog,which)->execute(call,()->folders.save(id,files)))
                    .setNegativeButton("Cancel",(dialog,which)->call.reject("Save cancelled")).setOnCancelListener(dialog->call.reject("Save cancelled")).show());
            }catch(Exception error){call.reject("Reopen the device folder before saving. Check its permission.");}
        });}catch(RejectedExecutionException error){call.reject("Native operations are busy. Try again shortly.");}
    }
    @PluginMethod public void gitRequest(PluginCall call){
        String raw=call.getString("url"),method=call.getString("method","GET");
        try{
            URI uri=GitTransport.validate(raw,method);
            boolean refs=uri.getPath().endsWith("/info/refs");
            Task request=()->{
                String encoded=call.getString("body","");if(encoded.length()>24*1024*1024)throw new IllegalArgumentException("Git request too large");byte[] body=method.equals("GET")?null:android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
                JSONObject credentials=vault.read("github");String authorization=credentials==null?null:android.util.Base64.encodeToString(("x-access-token:"+credentials.getString("key")).getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP);
                Map<String,String> headers=GitTransport.headers(uri,authorization);
                ProviderClient.Response response=new ProviderClient.Network().execute(uri,method,headers,body,16*1024*1024);
                return new JSONObject().put("statusCode",response.status).put("body",android.util.Base64.encodeToString(response.body,android.util.Base64.NO_WRAP)).put("headers",new JSONObject().put("content-type",response.contentType==null?"application/octet-stream":response.contentType));
            };
            if(method.equals("POST")&&uri.getPath().endsWith("git-receive-pack"))getActivity().runOnUiThread(()->new AlertDialog.Builder(getContext()).setTitle("Push Git changes?").setMessage("Upload commits to "+uri.getPath().replace("/git-receive-pack","")+"? Remote branches may be updated.").setPositiveButton("Push",(d,w)->execute(call,request)).setNegativeButton("Cancel",(d,w)->call.reject("Push cancelled")).setOnCancelListener(d->call.reject("Push cancelled")).show());
            else execute(call,request);
        }catch(Exception error){call.reject("Invalid GitHub transport URL");}
    }
    @Override protected void handleOnDestroy(){io.shutdownNow();super.handleOnDestroy();}
}
