"""Require actual, successful instrumentation results; a zero-test run is not readiness."""
from pathlib import Path
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]/'android/app/build/outputs/androidTest-results/connected'
reports=list(root.rglob('TEST-*.xml'))
if not reports:raise SystemExit('No Android instrumentation result files were produced')
tests=failures=errors=skipped=0
for report in reports:
 for suite in ET.parse(report).getroot().iter('testsuite'):
  tests+=int(suite.get('tests','0'));failures+=int(suite.get('failures','0'));errors+=int(suite.get('errors','0'));skipped+=int(suite.get('skipped','0'))
print(f'Android instrumentation: {tests} executed, {failures} failed, {errors} errors, {skipped} skipped')
if tests-skipped<=0 or failures or errors:raise SystemExit('Native Android checks did not pass')
