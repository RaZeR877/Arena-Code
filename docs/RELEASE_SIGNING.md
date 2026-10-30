# Android signing identity

Android updates must use the same signing identity as the installed app. Never replace a published key casually or put signing material into Git.

## This development session

A new user-authorized release identity was generated with a 3072-bit RSA key. The keystore and random credentials are stored outside the checkout in `/workspace/vynqode-private/`, with restricted filesystem permissions. No credential values were placed in source, build arguments, tool output or chat.

**Back up that private directory securely before distributing the release.** Keep the keystore and its password in durable, protected storage you control. Cloud workspace retention is not your signing-key backup. Losing this identity can prevent future updates. Do not upload the directory to the repository.

## Reusing the identity

Configure these variables securely in your shell/secret manager, without committing their values:

- `VYNQODE_KEYSTORE_PATH`: absolute path outside the checkout.
- `VYNQODE_KEYSTORE_PASSWORD`: keystore password.
- `VYNQODE_KEY_ALIAS`: signing alias.
- `VYNQODE_KEY_PASSWORD`: private-key password.

Run `npm run android:release` with Node 22, JDK 21 and Android SDK 35 available. It refuses missing bindings or an in-repository keystore, syncs web assets and builds a signed APK and AAB. Outputs live under `android/app/build/outputs/apk/release/` and `android/app/build/outputs/bundle/release/`.

For a genuinely new app with no existing signing identity, `npm run android:keygen` creates an external PKCS12 keystore using the configured credentials. It refuses to overwrite an existing key. Use the same store/key password for PKCS12; the command passes password variable *names* to keytool, never password values as arguments. Do not run key generation again for routine app updates.

The manual **Build signed Android release** workflow becomes available after merging the workflow onto the default branch. Configure the four repository secrets it names; the keystore is transported as `VYNQODE_KEYSTORE_BASE64`, decoded only into the temporary runner directory, and deleted after the job. Secret values are never generated or committed by that workflow. No store upload or publication is performed.

Debug and release builds have different signing keys. Export projects before replacing a debug installation; Android may require uninstalling it, which removes its app data. A signed artifact alone does not establish device compatibility or store readiness.
