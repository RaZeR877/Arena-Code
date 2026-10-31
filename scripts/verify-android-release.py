"""Verify APK integrity/signing/update identity without publishing or reading keystores."""
import argparse,hashlib,json,os,re,subprocess,zipfile
from pathlib import Path

def command(binary,*args):
 result=subprocess.run([str(binary),*map(str,args)],capture_output=True,text=True,timeout=60)
 if result.returncode:raise ValueError(binary.name+' rejected the APK: '+result.stderr.strip()[:500])
 return result.stdout

def inspect(apk,tools,current=True):
 digest=hashlib.sha256(apk.read_bytes()).hexdigest()
 signatures=command(tools/'apksigner','verify','--print-certs',apk)
 certificates=re.findall(r'Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)',signatures)
 if len(certificates)!=1:raise ValueError('Expected exactly one APK signing certificate')
 badging=command(tools/'aapt','dump','badging',apk)
 manifest=re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",badging)
 if not manifest:raise ValueError('APK package/version metadata unavailable')
 with zipfile.ZipFile(apk) as archive:
  required={'assets/public/index.html','assets/public/native-platform.js','assets/public/project-library.js','assets/public/playground-worker.js','assets/public/quickjs.wasm'}
  if current and not required.issubset(archive.namelist()):raise ValueError('APK is missing bundled IDE/runtime assets')
  if any(name.lower().endswith(('.jks','.keystore','.p12','.env')) for name in archive.namelist()):raise ValueError('Credential-like file is packaged in the APK')
  config=json.loads(archive.read('assets/capacitor.config.json'))
  if config.get('server',{}).get('url'):raise ValueError('Release APK points to a development server')
 return {'file':apk.name,'sha256':digest,'certificateSha256':certificates[0].lower(),'applicationId':manifest[1],'versionCode':int(manifest[2]),'versionName':manifest[3],'debuggable':'application-debuggable' in badging}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apk',required=True,type=Path);parser.add_argument('--previous-apk',type=Path);parser.add_argument('--expected-sha256');parser.add_argument('--expected-cert-sha256');parser.add_argument('--trusted-cert-file',type=Path);parser.add_argument('--allow-debug',action='store_true',help='Validate development artifacts only; report cannot certify a release');parser.add_argument('--sdk',type=Path,default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT'));parser.add_argument('--report',type=Path)
 args=parser.parse_args()
 try:
  if not args.sdk:raise ValueError('Set ANDROID_HOME or pass --sdk')
  versions=[path for path in (args.sdk/'build-tools').iterdir() if (path/'apksigner').exists() and (path/'aapt').exists()]
  if not versions:raise ValueError('Android build-tools apksigner/aapt are required')
  tools=max(versions,key=lambda path:tuple(int(part) for part in re.findall(r'\d+',path.name)))
  report=inspect(args.apk,tools)
  if report['applicationId']!='dev.vynqode.ide':raise ValueError('Unexpected Android application ID')
  if report['debuggable'] and not args.allow_debug:raise ValueError('Debuggable APK is not a release candidate')
  if args.expected_sha256 and report['sha256']!=args.expected_sha256.lower():raise ValueError('APK SHA-256 does not match the trusted download checksum')
  expected=args.trusted_cert_file.read_text().strip() if args.trusted_cert_file else args.expected_cert_sha256
  if expected and report['certificateSha256']!=expected.lower().replace(':',''):raise ValueError('Signing identity does not match the trusted release certificate')
  if args.previous_apk:
   previous=inspect(args.previous_apk,tools,current=False)
   if report['applicationId']!=previous['applicationId'] or report['certificateSha256']!=previous['certificateSha256']:raise ValueError('Update application/signing identity changed')
   if report['versionCode']<=previous['versionCode']:raise ValueError('Update versionCode must increase')
   report['previousVersionCode']=previous['versionCode']
  report['releaseArtifactChecksPassed']=not report['debuggable'];report['nativeRuntimeValidated']=False
  report['note']='Artifact checks only. Require current native instrumentation and physical-device coverage separately.'
  if args.report:args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps(report,indent=2))
 except (ValueError,OSError,subprocess.SubprocessError,zipfile.BadZipFile) as error:parser.exit(1,str(error)+'\n')
if __name__=='__main__':main()
