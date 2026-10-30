'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Android bundles the same local IDE without remote servers or permissive navigation',()=>{
 const config=JSON.parse(read('capacitor.config.json'));
 assert.equal(config.webDir,'dist/pages');assert.equal(config.appId,'dev.vynqode.ide');
 assert.equal(config.server.url,undefined);assert.equal(config.server.allowNavigation,undefined);
 assert.equal(config.android.allowMixedContent,false);
 const activity=read('android/app/src/main/java/dev/vynqode/ide/MainActivity.java');
 for(const name of ['androidBridge','CapacitorCookiesAndroidInterface','CapacitorHttpAndroidInterface'])assert.ok(activity.includes('removeJavascriptInterface("'+name+'")'));
 assert.match(read('android/app/src/main/res/xml/file_paths.xml'),/path="exports\/"/);
 assert.doesNotMatch(read('android/app/src/main/res/xml/file_paths.xml'),/external-path|path="\."/);
 assert.match(read('android/gradle/wrapper/gradle-wrapper.properties'),/distributionSha256Sum=[a-f0-9]{64}/);
});
test('browser engines remain identical across Node and Pages until duplicate modules are retired',()=>{
 for(const file of ['browser-core.js','ai-workflow.js'])assert.equal(read('public/'+file),read('pages/'+file));
});
