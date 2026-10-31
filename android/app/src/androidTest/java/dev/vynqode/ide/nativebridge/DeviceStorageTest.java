package dev.vynqode.ide.nativebridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DeviceStorageTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    @Test public void keystoreEncryptsPersistsAuthenticatesAndRemovesCredentials()throws Exception{
        String namespace="vault-fixture-"+UUID.randomUUID(),secret="fixture-not-a-real-api-key";
        SharedPreferences preferences=context.getSharedPreferences(namespace,Context.MODE_PRIVATE);
        try{
            CredentialVault vault=new CredentialVault(context,namespace);
            vault.save("openai",new JSONObject().put("key",secret));
            String first=preferences.getString("openai","");assertFalse(first.contains(secret));assertFalse(first.contains("\"key\""));
            assertEquals(secret,new CredentialVault(context,namespace).read("openai").getString("key"));
            vault.save("openai",new JSONObject().put("key",secret));assertNotEquals(first,preferences.getString("openai",""));
            // Provider AAD prevents moving a ciphertext record between providers.
            preferences.edit().putString("gemini",first).commit();
            try{vault.read("gemini");fail("Moved ciphertext accepted");}catch(IllegalStateException expected){assertFalse(expected.getMessage().contains(secret));}
            vault.remove("openai");assertNull(vault.read("openai"));
        }finally{
            preferences.edit().clear().commit();context.deleteSharedPreferences(namespace);
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);store.deleteEntry(namespace+".aes.v1");
        }
    }
    private void write(Uri uri,String text)throws Exception{try(OutputStream output=context.getContentResolver().openOutputStream(uri,"wt")){output.write(text.getBytes(StandardCharsets.UTF_8));}}
    @Test public void safPreflightsExternalEditsPreservesExcludedFilesAndRecoversWrites()throws Exception{
        Uri tree=DocumentsContract.buildTreeDocumentUri("dev.vynqode.ide.test.documents","root");
        Uri root=DocumentsContract.buildDocumentUriUsingTree(tree,"root");
        Uri directory=DocumentsContract.createDocument(context.getContentResolver(),root,DocumentsContract.Document.MIME_TYPE_DIR,"fixture-"+UUID.randomUUID());
        Uri selected=DocumentsContract.buildTreeDocumentUri("dev.vynqode.ide.test.documents",DocumentsContract.getDocumentId(directory));
        Uri source=DocumentsContract.createDocument(context.getContentResolver(),directory,"text/plain","app.js");
        Uri secret=DocumentsContract.createDocument(context.getContentResolver(),directory,"text/plain",".env");
        Uri added=null;
        SharedPreferences settings=context.getSharedPreferences("vynqode-device-projects",Context.MODE_PRIVATE);String oldTree=settings.getString("lastTree",null);
        try{
            write(source,"const original=1;");write(secret,"fixture-secret");Context isolated=new android.content.ContextWrapper(context){
                @Override public java.io.File getFilesDir(){java.io.File directory=new java.io.File(context.getCacheDir(),"folder-recovery-fixture");directory.mkdirs();return directory;}
            };FolderProjects folders=new FolderProjects(isolated);
            JSONObject opened=folders.open(selected);assertEquals(1,opened.getJSONObject("project").getJSONObject("files").length());assertEquals(1,opened.getJSONArray("omitted").length());
            write(source,"const external=2;");
            JSONObject desired=new JSONObject().put("app.js","const edited=3;").put("new.js","const added=4;");
            JSONObject conflict=folders.save(opened.getString("id"),desired);assertEquals(1,conflict.getJSONArray("conflicts").length());assertEquals(0,conflict.getJSONArray("written").length());assertFalse(conflict.getBoolean("partial"));
            assertNull(androidx.documentfile.provider.DocumentFile.fromTreeUri(context,selected).findFile("new.js"));
            opened=folders.open(selected);assertEquals(0,folders.removedPaths(opened.getString("id"),desired).length());JSONObject saved=folders.save(opened.getString("id"),desired);assertEquals(0,saved.getJSONArray("conflicts").length());assertEquals(2,saved.getJSONArray("written").length());
            added=DocumentsContract.buildDocumentUriUsingTree(selected,DocumentsContract.getDocumentId(directory)+"/new.js");
            JSONObject reopened=folders.open(selected);assertEquals("const edited=3;",reopened.getJSONObject("project").getJSONObject("files").getString("app.js"));
            assertTrue(androidx.documentfile.provider.DocumentFile.fromTreeUri(context,selected).findFile(".env").exists());
            assertTrue(new java.io.File(isolated.getFilesDir(),"device-recovery").listFiles().length>0);
            assertEquals(1,folders.removedPaths(reopened.getString("id"),new JSONObject().put("app.js","const edited=3;")).length());try{folders.save(reopened.getString("id"),new JSONObject().put("app.js","const edited=3;"),false);fail("Unapproved deletion accepted");}catch(IllegalStateException expected){}JSONObject removed=folders.save(reopened.getString("id"),new JSONObject().put("app.js","const edited=3;"));assertEquals(1,removed.getJSONArray("written").length());added=null;
        }finally{
            if(oldTree==null)settings.edit().remove("lastTree").commit();else settings.edit().putString("lastTree",oldTree).commit();
            if(added!=null)DocumentsContract.deleteDocument(context.getContentResolver(),added);
            DocumentsContract.deleteDocument(context.getContentResolver(),source);DocumentsContract.deleteDocument(context.getContentResolver(),secret);DocumentsContract.deleteDocument(context.getContentResolver(),directory);
        }
    }
}
