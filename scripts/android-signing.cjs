'use strict';
// Passwords are read from environment bindings, never arguments, files in Git or logs.
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const required=['VYNQODE_KEYSTORE_PATH','VYNQODE_KEYSTORE_PASSWORD','VYNQODE_KEY_ALIAS','VYNQODE_KEY_PASSWORD'];
const missing=required.filter(name=>!process.env[name]);
if(missing.length){console.error('Securely configure these environment variables first: '+missing.join(', '));process.exit(1);}
const file=path.resolve(process.env.VYNQODE_KEYSTORE_PATH);const root=path.resolve(__dirname,'..');
if(file===root||file.startsWith(root+path.sep)){console.error('Keep the signing keystore outside the repository.');process.exit(1);}
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit',env:process.env});if(result.error){console.error(result.error.message);process.exit(1);}if(result.status!==0)process.exit(result.status||1);}
if(process.argv[2]==='create'){
 if(fs.existsSync(file)){console.error('Refusing to overwrite an existing keystore.');process.exit(1);}
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const actual=path.join(fs.realpathSync(path.dirname(file)),path.basename(file));
 if(actual===fs.realpathSync(root)||actual.startsWith(fs.realpathSync(root)+path.sep)){console.error('Keystore path resolves inside the repository.');process.exit(1);}
 const keytool=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'keytool.exe':'keytool'):'keytool';
 run(keytool,['-genkeypair','-keystore',file,'-storetype','PKCS12','-storepass:env','VYNQODE_KEYSTORE_PASSWORD','-keypass:env','VYNQODE_KEY_PASSWORD','-alias',process.env.VYNQODE_KEY_ALIAS,'-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Vynqode Android']);
 fs.chmodSync(file,0o600);console.log('Signing key created outside the checkout. Back it up securely before releasing.');
}else if(process.argv[2]==='release'){
 if(!fs.existsSync(file)){console.error('Configured keystore file does not exist.');process.exit(1);}
 if(fs.realpathSync(file).startsWith(fs.realpathSync(root)+path.sep)){console.error('Keystore resolves inside the repository.');process.exit(1);}
 run(process.platform==='win32'?'npm.cmd':'npm',['run','android:sync']);
 run(path.join(root,'android',process.platform==='win32'?'gradlew.bat':'gradlew'),['-p',path.join(root,'android'),'assembleRelease','bundleRelease']);
}else{console.error('Use create or release.');process.exit(1);}
