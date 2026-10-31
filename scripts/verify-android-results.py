"""Require successful, nonzero instrumentation results and the requested test classes."""
from pathlib import Path
import argparse,xml.etree.ElementTree as ET
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--results-dir',type=Path,default=Path(__file__).resolve().parents[1]/'android/app/build/outputs/androidTest-results/connected')
parser.add_argument('--min-tests',type=int,default=1)
parser.add_argument('--required-class',action='append',default=[])
args=parser.parse_args();reports=list(args.results_dir.rglob('TEST-*.xml'))
if not reports:raise SystemExit('No Android instrumentation result files were produced')
tests=failures=errors=skipped=0;classes=set()
for report in reports:
 root=ET.parse(report).getroot()
 for suite in root.iter('testsuite'):
  tests+=int(suite.get('tests','0'));failures+=int(suite.get('failures','0'));errors+=int(suite.get('errors','0'));skipped+=int(suite.get('skipped','0'))
 for case in root.iter('testcase'):
  if case.find('skipped') is None and case.find('failure') is None and case.find('error') is None:classes.add(case.get('classname',''))
print(f'Android instrumentation: {tests} executed, {failures} failed, {errors} errors, {skipped} skipped')
if tests-skipped<max(1,args.min_tests) or failures or errors:raise SystemExit('Native Android checks did not pass')
missing=set(args.required_class)-classes
if missing:raise SystemExit('Required native test classes were not executed successfully: '+', '.join(sorted(missing)))
