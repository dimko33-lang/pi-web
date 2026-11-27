#!/usr/bin/env python3
"""Offline project-boundary tests. Linux integration is exercised separately on an empty VM."""
import json, runpy, shutil, tempfile
from pathlib import Path
from unittest.mock import patch
from content_boundary import check_public_path
from prepare import REPO, verify

def main():
    m,_=verify();src=REPO/'rootfs';pfiles=set(m['files']);reg=json.loads((src/'etc/nikita-home-save/projects.json').read_bytes())['projects'];roots={p for group in reg.values() for p in group}
    for path in ('srv/nikita-projects/workspace/work/index.js','srv/nikita-projects/workspace/release-a/server.js','var/www/pi-web-public/index.html','var/lib/nikita-publications/example.json','srv/pi-workspaces/browser/rootfs/opt/pi-web/projects/private/page.html','opt/projects/private/release.zip','var/lib/nikita-live-archive/messages/user1.json'):
        try:check_public_path(path)
        except ValueError:pass
        else:raise AssertionError('Private path accepted: '+path)
        assert any(path.startswith(root+'/') for root in roots),('private Save root missing',path)
    assert 'usr/local/bin/nikita-project' in pfiles and not any(p.startswith(('srv/nikita-projects/','opt/projects/','var/www/pi-web-public/')) for p in pfiles)
    assert (src/'etc/nikita-project-route/upstream.conf').read_text().strip()=='return 404;'
    image=(src/'opt/nikita-project-runtime/Dockerfile').read_text();assert not any(x.strip().split(' ')[0].upper() in ('COPY','ADD') for x in image.splitlines())
    app=runpy.run_path(str(src/'usr/local/lib/nikita-project-release.py'));fn=app['release'];g=fn.__globals__
    with tempfile.TemporaryDirectory() as tmp:
        base=Path(tmp)/'volume';routes=Path(tmp)/'routes';work=base/'work';work.mkdir(parents=True);routes.mkdir();(routes/'upstream.conf').write_text('return 404;\n');calls=[]
        def fake(args,check=True):
            calls.append(list(args))
            if args[0]=='/usr/bin/cp':shutil.copytree(work,Path(args[-1]),dirs_exist_ok=True)
            elif args[0]==g['D'] and 'run' in args:
                assert '--cap-drop' in args and '1000:1000' in args and '--read-only' in args
                assert not any('docker.sock' in str(x) or '--env-file'==x for x in args)
        health_calls=[]
        def healthy(slot,status):health_calls.append((slot,status))
        with patch.dict(g,{'BASE':base,'WORK':work,'ROUTES':routes,'call':fake,'health':healthy}),patch('os.path.ismount',return_value=True),patch('os.chown'):
            try:fn('publish')
            except ValueError:pass
            else:raise AssertionError('Published empty app')
            assert '404' in (routes/'upstream.conf').read_text();(work/'package.json').write_text('{"name":"test-only"}')
            (work/'marker').write_text('first');fn('check');assert '404' in (routes/'upstream.conf').read_text()
            first=fn('publish')['live'];assert (base/('release-'+first)/'marker').read_text()=='first';(work/'marker').write_text('next');second=fn('publish')['live'];assert second!=first and (base/('release-'+second)/'marker').read_text()=='next'
            assert fn('rollback')['live']==first and fn('withdraw')['withdrawn'];assert fn('rollback')['live']==first
            before=(routes/'upstream.conf').read_bytes()
            with patch.dict(g,{'health':lambda *args:(_ for _ in ()).throw(ValueError('fixture unhealthy'))}):
                try:fn('publish')
                except ValueError:pass
                else:raise AssertionError('Published unhealthy candidate')
            assert before==(routes/'upstream.conf').read_bytes() and calls and health_calls
    print('Public boundary, recursive private roots, empty install, project snapshots and release transitions passed (mocked Docker/nginx).')
if __name__=='__main__':main()
