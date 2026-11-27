#!/usr/bin/env python3
"""Verify the reference payload or render it to a NEW offline directory. Never install or start it."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile

REPO = Path(__file__).resolve().parents[1]
PAYLOAD = REPO / 'rootfs'
META = REPO / 'deployment'
TOKEN = re.compile(r'@@([A-Z][A-Z_0-9]*)@@')
VENV = '/srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent/venv'

def load(path):
    def unique(pairs):
        result = dict(pairs)
        if len(result) != len(pairs): raise ValueError('Duplicate JSON key')
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=unique)

def digest(data): return hashlib.sha256(data).hexdigest()

def verify():
    manifest = load(META/'source.json'); schema = load(META/'bindings.json'); acl = load(META/'ownership.json')
    actual = set()
    for f in PAYLOAD.rglob('*'):
        if f.is_symlink(): raise ValueError('Unexpected source symlink: '+str(f))
        if f.is_file(): actual.add(f.relative_to(PAYLOAD).as_posix())
    if actual != set(manifest['files']): raise ValueError('Unexpected/missing payload file')
    seen = set()
    for name, item in manifest['files'].items():
        data = (PAYLOAD/name).read_bytes()
        if digest(data) != item['sha256']: raise ValueError('Source mismatch: '+name)
        seen.update(TOKEN.findall(name)); seen.update(t.decode() for t in re.findall(rb'@@([A-Z][A-Z_0-9]*)@@',data))
    if seen != set(schema): raise ValueError('Binding inventory mismatch')
    if set(acl['files']) != actual | set(manifest['links']): raise ValueError('Ownership inventory mismatch')
    return manifest, schema

def bindings(schema, values):
    expected = {k for k,v in schema.items() if v not in ('derived','venv-instance')}
    if set(values) != expected: raise ValueError('Missing/unexpected keys: '+', '.join(sorted(set(values)^expected)))
    v = dict(values)
    for k,t in schema.items():
        if t in ('derived','venv-instance'):continue
        x = v[k]
        if not isinstance(x,str):raise ValueError(k+' must be a string')
        if t=='host': good=len(x)<=250 and '.' in x and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in x.split('.'))
        elif t=='integer':good=re.fullmatch(r'[1-9][0-9]{0,15}',x) and int(x)<2**53
        elif t=='secret64':good=re.fullmatch(r'[a-f0-9]{64}',x)
        elif t=='access-token':good=re.fullmatch(r'[A-Za-z0-9_-]{32,128}',x)
        elif t.startswith('hex'):good=re.fullmatch(r'[a-f0-9]{'+str(int(t[3:]))+'}',x)
        elif t=='identifier':good=re.fullmatch(r'[A-Za-z0-9_-]{1,100}',x)
        elif t=='label':good=len(x)<=64 and x.strip()==x and any(c.isalpha() for c in x) and all(c.isalpha() or c in ' -' for c in x)
        else:good=False
        if not good:raise ValueError('Invalid '+k)
    for t in ('integer','secret64'):
        xs=[v[k] for k in schema if schema[k]==t or (t=='secret64' and schema[k]=='access-token')]
        if len(set(xs))!=len(xs):raise ValueError(t+' bindings must be distinct')
    for k,t in schema.items():
        if t=='derived':
            peer=v[k.removesuffix('_SHORT')]
            if not re.fullmatch('100[1-9][0-9]+',peer):raise ValueError('Expected a channel peer for '+k)
            v[k]=peer[3:]
        if t=='venv-instance':v[k]=digest(VENV.encode())[:12]
    return v

def stage(manifest, values, target):
    # Install nothing. Preserve link semantics in the virtual filesystem; absolute
    # reference links must not point out of the staging tree on the audit machine.
    target = target.absolute(); parent = target.parent.resolve(strict=True); target=parent/target.name
    if target.exists() or target.is_symlink():raise ValueError('Destination must not exist')
    def subst(x):return TOKEN.sub(lambda m:values[m[1]],x)
    def safe(n):
        p=PurePosixPath(n)
        if p.is_absolute() or '..' in p.parts or str(p)!=n:raise ValueError('Invalid staged path')
        return p
    # Reserve the destination exclusively. Remove it if rendering fails. No symlink
    # is created until after every ordinary file has been written.
    target.mkdir(mode=0o700)
    try:
        for n,item in manifest['files'].items():
            data=(PAYLOAD/n).read_bytes()
            if digest(data)!=item['sha256']:raise ValueError('Source changed during staging: '+n)
            if re.search(rb'@@[A-Z][A-Z_0-9]*@@',data):data=subst(data.decode()).encode()
            dest=target/safe(subst(n));dest.parent.mkdir(parents=True,exist_ok=True)
            with dest.open('xb') as f:f.write(data)
            dest.chmod(int(item['mode'],8)&0o777)
        for n,raw in manifest['links'].items():
            dest=target/safe(subst(n));dest.parent.mkdir(parents=True,exist_ok=True)
            raw=subst(raw);virtual=(target/safe(raw[1:]) if raw.startswith('/') else dest.parent/raw).resolve()
            if not virtual.is_relative_to(target):raise ValueError('Link escapes staged root')
            dest.symlink_to(os.path.relpath(virtual,dest.parent))
    except BaseException:
        shutil.rmtree(target);raise

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--bindings',type=Path);ap.add_argument('--stage',type=Path);a=ap.parse_args();m,s=verify()
    if bool(a.stage)!=bool(a.bindings):ap.error('--stage and --bindings must be used together')
    if a.stage:stage(m,bindings(s,load(a.bindings)),a.stage)
    print('Verified reference payload:',len(m['files']),'files,',len(m['links']),'links.' + (' Offline tree prepared; nothing installed.' if a.stage else ''))
if __name__=='__main__':main()
