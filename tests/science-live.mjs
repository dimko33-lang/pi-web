// Run on a prepared stock Linux host as the broker's transport UID. No model call.
import assert from 'node:assert/strict';
import {science} from '../server/instance-tools.ts';
const r=await science({action:'python',seconds:30,code:`import os, sympy as s, numpy as np
print(os.getuid(), s.factor(s.Symbol('x')**2-1), int(round(np.linalg.det([[2,0],[0,3]]))))
print(sorted(os.listdir('/sys/class/net')))`});
assert.equal(r.ok,true);assert.equal(r.limits.network,false);
assert.match(r.stdout.text,/65534 \(x - 1\)\*\(x \+ 1\) 6/);assert.match(r.stdout.text,/\['lo'\]/);
console.log('Scientific broker verified: SymPy, NumPy, unprivileged UID and loopback-only network.');
