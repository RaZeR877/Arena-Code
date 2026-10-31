package dev.vynqode.ide.nativebridge;

import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ProviderClientTest {
    private JSONObject config(String model)throws Exception{return new JSONObject().put("key","fixture-only-not-a-real-key").put("models",new JSONArray().put(model)).put("endpoint","https://fixture.example/v1/chat/completions");}
    private JSONArray messages()throws Exception{return new JSONArray().put(new JSONObject().put("role","system").put("content","Review code")).put(new JSONObject().put("role","user").put("content","Explain the project"));}
    @Test public void providerFormatsKeepCredentialsInNativeHeaders()throws Exception{
        for(String provider:new String[]{"openai","anthropic","gemini","custom"}){
            JSONObject result=ProviderClient.complete(provider,config("fixture-model"),"fixture-model",messages(),(uri,method,headers,bytes,limit)->{
                assertEquals("POST",method);assertEquals("https",uri.getScheme());assertEquals(1500000,limit);
                String body=new String(bytes,StandardCharsets.UTF_8);assertFalse(body.contains("fixture-only-not-a-real-key"));assertFalse(uri.toString().contains("fixture-only"));
                String response;
                if(provider.equals("anthropic")){assertEquals("fixture-only-not-a-real-key",headers.get("x-api-key"));assertTrue(new JSONObject(body).has("system"));response="{\"content\":[{\"type\":\"text\",\"text\":\"fixture response\"}]}";}
                else if(provider.equals("gemini")){assertEquals("fixture-only-not-a-real-key",headers.get("x-goog-api-key"));assertTrue(uri.getPath().endsWith("fixture-model:generateContent"));assertTrue(new JSONObject(body).has("contents"));response="{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"fixture response\"}]}}]}";}
                else{assertEquals("Bearer fixture-only-not-a-real-key",headers.get("Authorization"));assertTrue(new JSONObject(body).has("messages"));response="{\"choices\":[{\"message\":{\"content\":\"fixture response\"}}]}";}
                return new ProviderClient.Response(200,response.getBytes(StandardCharsets.UTF_8),"application/json");
            });
            assertEquals("fixture response",result.getString("text"));assertFalse(result.has("key"));
        }
    }
    @Test public void endpointModelAndContextValidationPrecedesNetwork()throws Exception{
        for(String endpoint:new String[]{"http://example.com/v1/chat/completions","https://user:password@example.com/v1/","https://example.com/v1/?key=secret","file:///data/private"}){
            try{ProviderClient.endpoint("custom",endpoint);fail("Endpoint accepted");}catch(Exception expected){}
        }
        assertEquals("127.0.0.1",ProviderClient.endpoint("ollama","http://127.0.0.1:11434/v1/chat/completions").getHost());
        try{ProviderClient.endpoint("ollama","http://192.168.1.2:11434/v1/chat/completions");fail("Cleartext LAN endpoint accepted");}catch(Exception expected){}
        ProviderClient.Transport forbidden=(u,m,h,b,l)->{throw new AssertionError("Invalid request reached network");};
        try{ProviderClient.complete("openai",config("allowed"),"other",messages(),forbidden);fail("Unlisted model accepted");}catch(IllegalArgumentException expected){}
        JSONArray invalid=new JSONArray().put(new JSONObject().put("role","tool").put("content","bad"));
        try{ProviderClient.complete("openai",config("allowed"),"allowed",invalid,forbidden);fail("Invalid role accepted");}catch(IllegalArgumentException expected){}
    }
    @Test public void errorBodiesNeverReturnProviderCredentialEchoes()throws Exception{
        try{ProviderClient.complete("openai",config("allowed"),"allowed",messages(),(u,m,h,b,l)->new ProviderClient.Response(401,"fixture-only-not-a-real-key".getBytes(StandardCharsets.UTF_8),"text/plain"));fail("Provider error accepted");}
        catch(IllegalStateException expected){assertFalse(expected.getMessage().contains("fixture-only"));assertTrue(expected.getMessage().contains("401"));}
    }
    @Test public void unsafeFolderPathsAreRejected(){
        for(String path:new String[]{"../secret","a/../x",".git/config",".env","keys/token.p12","node_modules/lib.js","/absolute","a\\b"}){try{FolderProjects.safePath(path);fail("Unsafe path accepted");}catch(IllegalArgumentException expected){}}
        assertEquals("src/app.js",FolderProjects.safePath("src/app.js"));
    }
    @Test public void actualNativeHttpRefusesRedirectsAndBoundsDeclaredAndChunkedBodies()throws Exception{
        java.net.ServerSocket server=new java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));
        java.util.concurrent.atomic.AtomicInteger redirected=new java.util.concurrent.atomic.AtomicInteger();
        Thread fixture=new Thread(()->{while(!server.isClosed())try(java.net.Socket socket=server.accept()){
            socket.setSoTimeout(3000);java.io.BufferedReader input=new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII));
            String request=input.readLine(),line;while((line=input.readLine())!=null&&!line.isEmpty()){};
            String path=request.split(" ")[1];String response;
            if(path.equals("/redirect"))response="HTTP/1.1 302 Found\r\nLocation: /target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            else if(path.equals("/chunked"))response="HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n64\r\n"+"x".repeat(100)+"\r\n0\r\n\r\n";
            else{if(path.equals("/target"))redirected.incrementAndGet();response="HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n"+"x".repeat(100);}
            socket.getOutputStream().write(response.getBytes(StandardCharsets.US_ASCII));socket.getOutputStream().flush();
        }catch(java.io.IOException ignored){}});fixture.setDaemon(true);fixture.start();
        try{
            for(String path:new String[]{"/redirect","/large","/chunked"}){
                try{new ProviderClient.Network().execute(new java.net.URI("http://127.0.0.1:"+server.getLocalPort()+path),"GET",java.util.Collections.emptyMap(),null,16);fail("Unsafe/oversize HTTP response accepted");}
                catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("Redirect")||expected.getMessage().contains("size limit"));}
            }
            assertEquals(0,redirected.get());
        }finally{server.close();fixture.join(1000);}
    }
    @Test public void gitTransportRejectsNonGitHubCredentialUrlsAndWrongMethods()throws Exception{
        for(String value:new String[]{"http://github.com/a/b.git/info/refs?service=git-upload-pack","https://user:token@github.com/a/b.git/info/refs?service=git-upload-pack","https://example.com/a/b.git/info/refs?service=git-upload-pack","https://github.com/a/b.git/info/refs?service=git-upload-pack&token=secret","https://github.com/a/b.git/%67it-upload-pack"}){
            try{GitTransport.validate(value,"GET");fail("Unsafe Git URL accepted");}catch(IllegalArgumentException expected){}
        }
        java.net.URI refs=GitTransport.validate("https://github.com/a/b.git/info/refs?service=git-upload-pack","GET");assertFalse(GitTransport.headers(refs,null).containsKey("Authorization"));
        try{GitTransport.validate("https://github.com/a/b.git/git-receive-pack","GET");fail("GET push accepted");}catch(IllegalArgumentException expected){}
    }
    @Test public void gitTransportAttachesOnlyNativeAuthorizationAndProtocolHeaders()throws Exception{
        java.net.URI uri=GitTransport.validate("https://github.com/a/b.git/git-receive-pack","POST");java.util.Map<String,String> headers=GitTransport.headers(uri,"fixture-base64-token");
        assertEquals("Basic fixture-base64-token",headers.get("Authorization"));assertEquals("application/x-git-receive-pack-request",headers.get("Content-Type"));assertFalse(uri.toString().contains("fixture"));
    }

    @Test public void invalidCredentialCharactersFailWithoutEchoBeforeNetwork()throws Exception{
        String secret="fixture-secret\nInjected: header";JSONObject config=config("allowed").put("key",secret);
        try{ProviderClient.complete("openai",config,"allowed",messages(),(u,m,h,b,l)->{throw new AssertionError("Invalid credential reached network");});fail("Header injection accepted");}
        catch(IllegalArgumentException expected){assertFalse(expected.getMessage().contains("fixture-secret"));assertFalse(expected.getMessage().contains("Injected"));}
    }

}
