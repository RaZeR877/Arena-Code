package dev.vynqode.ide.nativebridge;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import androidx.documentfile.provider.DocumentFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** User-granted SAF trees only. Preflight conflicts before any writes; keep private recovery data. */
public final class FolderProjects {
    private static final int MAX_FILE=400*1024,MAX_TOTAL=3*1024*1024;
    private final Context context;
    private DocumentFile root;
    private String id;
    private final Map<String,String> baseline=new LinkedHashMap<>();
    public FolderProjects(Context context){this.context=context;}
    public static String safePath(String path){
        if(path==null||path.isEmpty()||path.length()>240||path.startsWith("/")||path.contains("\\")||path.indexOf('\0')>=0)throw new IllegalArgumentException("Invalid project path");
        for(String part:path.split("/",-1)){
            String lower=part.toLowerCase(Locale.ROOT);
            if(part.isEmpty()||part.equals(".")||part.equals("..")||part.matches(".*[\\x00-\\x1f].*")||lower.matches("\\.git|\\.env(?:\\..*)?|\\.npmrc|\\.pypirc|\\.netrc|\\.git-credentials|node_modules|\\.ssh|\\.aws|\\.cache|dist|build|\\.next")||lower.matches("id_rsa|id_ed25519|id_ecdsa|id_dsa|.*\\.(pem|p12|pfx|key|jks|keystore)"))throw new IllegalArgumentException("Unsafe project path");
        }return path;
    }
    private static String hash(byte[] bytes)throws Exception{byte[] value=MessageDigest.getInstance("SHA-256").digest(bytes);char[] out=new char[value.length*2];String digits="0123456789abcdef";for(int i=0;i<value.length;i++){out[i*2]=digits.charAt((value[i]&255)>>>4);out[i*2+1]=digits.charAt(value[i]&15);}return new String(out);}
    private byte[] bytes(DocumentFile file)throws Exception{
        if(file.length()>MAX_FILE)throw new IllegalArgumentException("File exceeds 400 KiB");
        try(InputStream input=context.getContentResolver().openInputStream(file.getUri())){
            if(input==null)throw new IllegalStateException("Cannot read document");ByteArrayOutputStream result=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
            while((n=input.read(buffer))!=-1){if(result.size()+n>MAX_FILE)throw new IllegalArgumentException("File exceeds 400 KiB");result.write(buffer,0,n);}return result.toByteArray();
        }
    }
    private static String text(byte[] value)throws Exception{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString();}
    private void walk(DocumentFile dir,String prefix,JSONObject files,Map<String,String> hashes,JSONArray omitted,int[] budget)throws Exception{
        if(prefix.split("/").length>20)throw new IllegalArgumentException("Project directory nesting exceeds 20 levels");
        for(DocumentFile file:dir.listFiles()){
            if(++budget[0]>5000)throw new IllegalArgumentException("Directory has too many entries; choose a smaller project folder");
            String name=file.getName();if(name==null)continue;String path=prefix+name;
            try{safePath(path);}catch(IllegalArgumentException error){if(omitted.length()<200)omitted.put(path);continue;}
            if(file.isDirectory()){walk(file,path+"/",files,hashes,omitted,budget);continue;}
            if(!file.isFile())continue;
            byte[] data;String content;
            try{data=bytes(file);content=text(data);if(content.indexOf('\0')>=0)throw new IllegalArgumentException("Binary file");}
            catch(IllegalArgumentException|java.nio.charset.CharacterCodingException error){if(omitted.length()<200)omitted.put(path);continue;}
            budget[1]+=data.length;
            if(files.length()>=100||budget[1]>MAX_TOTAL)throw new IllegalArgumentException("Project exceeds 100 text files / 3 MiB; choose a smaller folder");
            files.put(path,content);hashes.put(path,hash(data));
        }
    }
    public synchronized JSONObject open(Uri uri)throws Exception{
        DocumentFile selected=DocumentFile.fromTreeUri(context,uri);
        if(selected==null||!selected.isDirectory()||!selected.canRead())throw new IllegalStateException("Folder permission is unavailable. Choose the folder again.");
        JSONObject files=new JSONObject();Map<String,String> hashes=new LinkedHashMap<>();JSONArray omitted=new JSONArray();walk(selected,"",files,hashes,omitted,new int[2]);
        root=selected;id=UUID.randomUUID().toString();baseline.clear();baseline.putAll(hashes);
        context.getSharedPreferences("vynqode-device-projects",Context.MODE_PRIVATE).edit().putString("lastTree",uri.toString()).apply();
        return new JSONObject().put("id",id).put("readOnly",!selected.canWrite()).put("hasGit",selected.findFile(".git")!=null).put("omitted",omitted)
            .put("project",new JSONObject().put("name",selected.getName()==null?"Device project":selected.getName()).put("files",files));
    }
    public JSONObject reopen()throws Exception{
        String uri=context.getSharedPreferences("vynqode-device-projects",Context.MODE_PRIVATE).getString("lastTree",null);
        if(uri==null)throw new IllegalStateException("Choose a device folder first");return open(Uri.parse(uri));
    }
    private DocumentFile find(String path,boolean createParents)throws Exception{
        String[] parts=safePath(path).split("/");DocumentFile directory=root;
        for(int i=0;i<parts.length-1;i++){
            DocumentFile child=directory.findFile(parts[i]);
            if(child==null&&createParents)child=directory.createDirectory(parts[i]);
            if(child==null)return null;if(!child.isDirectory())throw new IllegalStateException("A parent path is a file");directory=child;
        }
        DocumentFile file=directory.findFile(parts[parts.length-1]);
        if(file==null)for(DocumentFile child:directory.listFiles())if(parts[parts.length-1].equalsIgnoreCase(child.getName()))throw new IllegalStateException("A path differs only by letter case; use a distinct intermediate name");
        return file;
    }
    private DocumentFile create(String path)throws Exception{
        find(path,true);String[] parts=path.split("/");DocumentFile directory=root;
        for(int i=0;i<parts.length-1;i++)directory=directory.findFile(parts[i]);
        String extension=android.webkit.MimeTypeMap.getFileExtensionFromUrl(path);String mime=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        DocumentFile file=directory.createFile(mime==null?"application/octet-stream":mime,parts[parts.length-1]);
        if(file==null||!parts[parts.length-1].equals(file.getName()))throw new IllegalStateException("Document provider could not create the exact filename");return file;
    }
    public synchronized JSONObject save(String requestedId,JSONObject files)throws Exception{
        if(root==null||id==null||!id.equals(requestedId))throw new IllegalStateException("Reopen the device folder before saving");
        if(!root.canWrite())throw new IllegalStateException("This folder grant is read-only");
        if(files==null||files.length()>100)throw new IllegalArgumentException("Project exceeds 100 files");
        Map<String,byte[]> desired=new LinkedHashMap<>();int total=0;
        for(String path:keys(files)){safePath(path);byte[] data=files.getString(path).getBytes(StandardCharsets.UTF_8);total+=data.length;if(data.length>MAX_FILE||total>MAX_TOTAL)throw new IllegalArgumentException("Project exceeds storage limits");desired.put(path,data);}
        List<String> paths=new ArrayList<>(baseline.keySet());for(String path:desired.keySet())if(!paths.contains(path))paths.add(path);
        for(String path:desired.keySet())for(String other:desired.keySet())if(!path.equals(other)&&(other.toLowerCase(Locale.ROOT).startsWith(path.toLowerCase(Locale.ROOT)+"/")||other.equalsIgnoreCase(path)))throw new IllegalArgumentException("File/directory path conflict");
        JSONArray conflicts=new JSONArray();Map<String,byte[]> previous=new HashMap<>();List<String> changed=new ArrayList<>();
        for(String path:paths){DocumentFile current=find(path,false);String old=baseline.get(path);
            if(old!=null){if(current==null||!current.isFile()){conflicts.put(path);continue;}byte[] data=bytes(current);if(!hash(data).equals(old)){conflicts.put(path);continue;}previous.put(path,data);}
            else if(current!=null){conflicts.put(path);continue;}
            byte[] next=desired.get(path);if(next==null||old==null||!old.equals(hash(next)))changed.add(path);
        }
        if(conflicts.length()>0)return new JSONObject().put("conflicts",conflicts).put("written",new JSONArray()).put("partial",false);
        if(!changed.isEmpty())backup(previous,changed);
        JSONArray written=new JSONArray();
        for(String path:changed){
            try{
                DocumentFile file=find(path,false);String expected=baseline.get(path);
                if(expected==null&&file!=null||expected!=null&&(file==null||!hash(bytes(file)).equals(expected)))throw new IllegalStateException("External change during save");
                byte[] data=desired.get(path);
                if(data==null){if(file!=null&&!file.delete())throw new IllegalStateException("Document deletion failed");}
                else {if(file==null)file=create(path);try(OutputStream output=context.getContentResolver().openOutputStream(file.getUri(),"wt")){if(output==null)throw new IllegalStateException("Cannot write document");output.write(data);}if(!hash(bytes(file)).equals(hash(data)))throw new IllegalStateException("Document write could not be verified");}
                written.put(path);
            }catch(Exception error){id=null;return new JSONObject().put("conflicts",new JSONArray().put(path)).put("written",written).put("partial",true).put("error","Save interrupted. Reopen the folder; your app snapshot and a private native recovery copy remain available.");}
        }
        baseline.clear();for(Map.Entry<String,byte[]> entry:desired.entrySet())baseline.put(entry.getKey(),hash(entry.getValue()));
        return new JSONObject().put("id",id).put("written",written).put("conflicts",new JSONArray()).put("partial",false);
    }
    private void backup(Map<String,byte[]> previous,List<String> changed)throws Exception{
        File directory=new File(context.getFilesDir(),"device-recovery");if(!directory.exists()&&!directory.mkdirs())throw new IllegalStateException("Recovery storage unavailable");
        JSONObject data=new JSONObject();for(String path:changed)if(previous.containsKey(path))data.put(path,Base64.encodeToString(previous.get(path),Base64.NO_WRAP));
        JSONObject record=new JSONObject().put("tree",root.getUri().toString()).put("files",data);
        File target=new File(directory,UUID.randomUUID()+".json");try(OutputStream output=new java.io.FileOutputStream(target)){output.write(record.toString().getBytes(StandardCharsets.UTF_8));}
        File[] backups=directory.listFiles();if(backups!=null&&backups.length>5){Arrays.sort(backups,(a,b)->Long.compare(a.lastModified(),b.lastModified()));for(int i=0;i<backups.length-5;i++)if(!backups[i].delete())throw new IllegalStateException("Cannot rotate recovery storage");}
    }
    private static List<String> keys(JSONObject object){List<String> result=new ArrayList<>();java.util.Iterator<String> keys=object.keys();while(keys.hasNext())result.add(keys.next());Collections.sort(result);return result;}
}
