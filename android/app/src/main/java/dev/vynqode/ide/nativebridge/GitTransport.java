package dev.vynqode.ide.nativebridge;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Pure validation/header policy shared by the native bridge and JVM security tests. */
public final class GitTransport {
    public static URI validate(String raw,String method)throws Exception{
        URI uri=new URI(raw);
        if(!"https".equals(uri.getScheme())||!"github.com".equals(uri.getHost())||uri.getUserInfo()!=null||uri.getFragment()!=null||(uri.getPort()!=-1&&uri.getPort()!=443)||!uri.getPath().equals(uri.getRawPath())||!uri.getPath().matches("/[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}\\.git/(info/refs|git-upload-pack|git-receive-pack)"))throw new IllegalArgumentException("Only GitHub HTTPS Git transport is supported");
        boolean refs=uri.getPath().endsWith("/info/refs");
        if(refs&&!("GET".equals(method)&&("service=git-upload-pack".equals(uri.getQuery())||"service=git-receive-pack".equals(uri.getQuery())))||!refs&&!("POST".equals(method)&&uri.getQuery()==null))throw new IllegalArgumentException("Invalid Git transport request");
        return uri;
    }
    public static Map<String,String> headers(URI uri,String basicCredential){
        Map<String,String> headers=new LinkedHashMap<>();headers.put("User-Agent","Vynqode-Git");
        if(!uri.getPath().endsWith("/info/refs"))headers.put("Content-Type",uri.getPath().endsWith("git-receive-pack")?"application/x-git-receive-pack-request":"application/x-git-upload-pack-request");
        if(basicCredential!=null&&!basicCredential.isEmpty())headers.put("Authorization","Basic "+basicCredential);
        return headers;
    }
}
