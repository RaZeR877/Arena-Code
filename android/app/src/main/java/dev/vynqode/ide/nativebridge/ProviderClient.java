package dev.vynqode.ide.nativebridge;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native HTTP only: fixed provider destinations, no redirects or browser credentials. */
public final class ProviderClient {
    public static final Map<String,String[]> DEFAULTS=new LinkedHashMap<>();
    static {
        DEFAULTS.put("openai",new String[]{"OpenAI","https://api.openai.com/v1/chat/completions","gpt-4.1-mini,gpt-4.1"});
        DEFAULTS.put("anthropic",new String[]{"Anthropic Claude","https://api.anthropic.com/v1/messages","claude-sonnet-4-5,claude-haiku-4-5"});
        DEFAULTS.put("gemini",new String[]{"Google Gemini","https://generativelanguage.googleapis.com/v1beta/models/","gemini-2.5-flash,gemini-2.5-pro"});
        DEFAULTS.put("openrouter",new String[]{"OpenRouter","https://openrouter.ai/api/v1/chat/completions","openai/gpt-4.1-mini"});
        DEFAULTS.put("groq",new String[]{"Groq","https://api.groq.com/openai/v1/chat/completions","llama-3.3-70b-versatile"});
        DEFAULTS.put("deepseek",new String[]{"DeepSeek","https://api.deepseek.com/chat/completions","deepseek-chat,deepseek-reasoner"});
        DEFAULTS.put("ollama",new String[]{"Ollama","http://127.0.0.1:11434/v1/chat/completions","qwen2.5-coder:7b"});
        DEFAULTS.put("custom",new String[]{"Custom HTTPS provider","","custom-model"});
    }
    public static final class Response {
        public final int status;public final byte[] body;public final String contentType;
        public Response(int status,byte[] body,String contentType){this.status=status;this.body=body;this.contentType=contentType;}
    }
    public interface Transport {Response execute(URI uri,String method,Map<String,String> headers,byte[] body,int limit) throws Exception;}
    public static final class Network implements Transport {
        public Response execute(URI uri,String method,Map<String,String> headers,byte[] body,int limit) throws Exception {
            HttpURLConnection connection=(HttpURLConnection)uri.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(45000);connection.setRequestMethod(method);
            try {
                for(Map.Entry<String,String> header:headers.entrySet())connection.setRequestProperty(header.getKey(),header.getValue());
                if(body!=null){connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);try(java.io.OutputStream out=connection.getOutputStream()){out.write(body);}}
                int status=connection.getResponseCode();
                if(status>=300&&status<400)throw new IllegalStateException("Redirects are not allowed");
                if(connection.getContentLengthLong()>limit)throw new IllegalStateException("Response exceeds size limit");
                InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                if(input!=null)try(InputStream stream=input){byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1){if(bytes.size()+count>limit)throw new IllegalStateException("Response exceeds size limit");bytes.write(buffer,0,count);}}
                return new Response(status,bytes.toByteArray(),connection.getContentType());
            } finally { connection.disconnect(); }
        }
    }
    public static URI endpoint(String provider,String configured) throws Exception {
        if(!DEFAULTS.containsKey(provider))throw new IllegalArgumentException("Unknown provider");
        String value=(provider.equals("custom")||provider.equals("ollama"))?configured:DEFAULTS.get(provider)[1];
        URI uri=new URI(value);
        if(uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getQuery()!=null)throw new IllegalArgumentException("Use a provider endpoint without credentials, query or fragment");
        boolean local=provider.equals("ollama")&&uri.getHost().equals("127.0.0.1")&&uri.getPort()==11434&&uri.getPath().equals("/v1/chat/completions");
        if(!uri.getScheme().equals("https")&&!(uri.getScheme().equals("http")&&local))throw new IllegalArgumentException("HTTPS is required except device-local Ollama");
        return uri;
    }
    public static JSONArray models(String text) throws Exception {
        JSONArray result=new JSONArray();
        for(String raw:text.split(",")){String value=raw.trim();if(!value.matches("[A-Za-z0-9][A-Za-z0-9._:/+\\-]{0,119}"))throw new IllegalArgumentException("Invalid model ID");if(result.length()>=20)throw new IllegalArgumentException("Choose at most 20 models");result.put(value);}
        if(result.length()==0)throw new IllegalArgumentException("A model is required");return result;
    }
    public static JSONObject complete(String provider,JSONObject config,String model,JSONArray messages,Transport transport) throws Exception {
        JSONArray allowed=config.getJSONArray("models");boolean found=false;for(int i=0;i<allowed.length();i++)if(allowed.getString(i).equals(model))found=true;
        if(!found)throw new IllegalArgumentException("Model is not configured");
        if(messages==null||messages.length()<1||messages.length()>40)throw new IllegalArgumentException("Provide 1–40 messages");
        JSONArray clean=new JSONArray();StringBuilder system=new StringBuilder();int total=0;
        for(int i=0;i<messages.length();i++){JSONObject message=messages.getJSONObject(i);String role=message.getString("role"),text=message.getString("content");
            if(!(role.equals("system")||role.equals("user")||role.equals("assistant"))||text.length()>42000||(total+=text.length())>100000)throw new IllegalArgumentException("Invalid or oversized context");
            clean.put(new JSONObject().put("role",role).put("content",text));if(role.equals("system"))system.append(text).append("\n");}
        URI uri=endpoint(provider,config.optString("endpoint"));Map<String,String> headers=new LinkedHashMap<>();headers.put("Content-Type","application/json");
        String key=config.optString("key");JSONObject body=new JSONObject().put("model",model);
        if(provider.equals("anthropic")){
            headers.put("x-api-key",key);headers.put("anthropic-version","2023-06-01");JSONArray chat=new JSONArray();
            for(int i=0;i<clean.length();i++)if(!clean.getJSONObject(i).getString("role").equals("system"))chat.put(clean.getJSONObject(i));
            if(chat.length()==0)chat.put(new JSONObject().put("role","user").put("content",system.toString()));
            body.put("system",system.toString()).put("messages",chat).put("max_tokens",3500);
        }else if(provider.equals("gemini")){
            headers.put("x-goog-api-key",key);uri=new URI(uri.toString()+model+":generateContent");JSONArray contents=new JSONArray();
            for(int i=0;i<clean.length();i++){JSONObject m=clean.getJSONObject(i);if(m.getString("role").equals("system"))continue;contents.put(new JSONObject().put("role",m.getString("role").equals("assistant")?"model":"user").put("parts",new JSONArray().put(new JSONObject().put("text",m.getString("content")))));}
            if(contents.length()==0)contents.put(new JSONObject().put("role","user").put("parts",new JSONArray().put(new JSONObject().put("text",system.toString()))));
            body=new JSONObject().put("contents",contents).put("systemInstruction",new JSONObject().put("parts",new JSONArray().put(new JSONObject().put("text",system.toString())))).put("generationConfig",new JSONObject().put("maxOutputTokens",3500));
        }else {if(!key.isEmpty())headers.put("Authorization","Bearer "+key);body.put("messages",clean).put(provider.equals("openai")?"max_completion_tokens":"max_tokens",3500).put("stream",false);}
        Response response=transport.execute(uri,"POST",headers,body.toString().getBytes(StandardCharsets.UTF_8),1500000);
        if(response.status<200||response.status>=300)throw new IllegalStateException("Provider HTTP "+response.status+". Check credentials, model and quota.");
        JSONObject payload=new JSONObject(new String(response.body,StandardCharsets.UTF_8));StringBuilder text=new StringBuilder();
        if(provider.equals("anthropic")){JSONArray parts=payload.optJSONArray("content");if(parts!=null)for(int i=0;i<parts.length();i++)if(parts.getJSONObject(i).optString("type").equals("text"))text.append(parts.getJSONObject(i).optString("text"));}
        else if(provider.equals("gemini")){JSONArray parts=payload.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts");for(int i=0;i<parts.length();i++)text.append(parts.getJSONObject(i).optString("text"));}
        else {Object content=payload.getJSONArray("choices").getJSONObject(0).getJSONObject("message").opt("content");if(content instanceof String)text.append(content);else if(content instanceof JSONArray){JSONArray parts=(JSONArray)content;for(int i=0;i<parts.length();i++)text.append(parts.getJSONObject(i).optString("text"));}}
        if(text.length()==0)throw new IllegalStateException("Provider returned no text");
        return new JSONObject().put("provider",provider).put("model",model).put("text",text.substring(0,Math.min(100000,text.length())));
    }
}
