package dev.vynqode.ide.nativebridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Device-only encrypted credentials. No plaintext key is returned to the WebView. */
public final class CredentialVault {
    public static final String PREFERENCES = "vynqode-ai-vault";
    private final SharedPreferences preferences;
    private final String alias;
    public CredentialVault(Context context) { this(context, PREFERENCES); }
    public CredentialVault(Context context, String namespace) {
        preferences=context.getSharedPreferences(namespace,Context.MODE_PRIVATE);
        alias=namespace+".aes.v1";
    }
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(alias))return (SecretKey)store.getKey(alias,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    public synchronized void save(String provider,JSONObject record) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        cipher.updateAAD(provider.getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext=cipher.doFinal(record.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject envelope=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("ciphertext",Base64.encodeToString(ciphertext,Base64.NO_WRAP));
        if(!preferences.edit().putString(provider,envelope.toString()).commit())throw new IllegalStateException("Credential save failed");
    }
    public synchronized JSONObject read(String provider) throws Exception {
        String value=preferences.getString(provider,null);if(value==null)return null;
        try {
            JSONObject envelope=new JSONObject(value);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));
            cipher.updateAAD(provider.getBytes(StandardCharsets.UTF_8));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("ciphertext"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
        } catch(Exception error) { throw new IllegalStateException("Stored credentials are unavailable. Configure this provider again."); }
    }
    public synchronized void remove(String provider) {
        if(!preferences.edit().remove(provider).commit())throw new IllegalStateException("Credential removal failed");
    }
}
