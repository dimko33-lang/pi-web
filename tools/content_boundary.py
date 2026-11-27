"""Independent distribution boundary. Never use this filter for a private Save."""
from pathlib import PurePosixPath

PANEL='srv/pi-workspaces/browser/rootfs/opt/pi-web/'
TG='srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent/'
READ_UI={'index.html','app.js','lc-index.html','lc-guest.html','lc-app.js','render.js'}
JSON={'etc/nikita-home-save/projects.json',PANEL+'models.json',TG+'tool-policy.json'}|{p+n for p in (PANEL,TG+'mathrender/',TG+'media-decoder/','opt/pi-web-runtime/') for n in ('package.json','package-lock.json')}

def check_public_path(name):
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or str(p)!=name:raise ValueError('Invalid public source path')
    private={'work','workspaces','release-a','release-b','release-c','data','sessions','users','uploads','backups','code-backups','.snapshots','node_modules','.git','messages','photos','.article-links','__pycache__'}
    allowed=not private.intersection(p.parts) and p.suffix.lower() not in {'.zip','.tar','.gz','.tgz','.db','.session','.sqlite','.sqlite3','.env','.pem','.key','.mp4','.ogg','.jpg','.jpeg','.webp','.ext4'}
    if name.startswith(('srv/nikita-projects/','opt/projects/','opt/curvelab-editor/','var/www/pi-web-public/',PANEL+'projects/')):allowed=False
    if name.startswith('srv/') and not (name.startswith((PANEL,TG,'srv/pi-workspaces/browser/rootfs/opt/site-entry/')) or name=='srv/pi-workspaces/browser/rootfs/opt/ENVIRONMENT.md'):allowed=False
    if name.startswith('var/www/'):
        if name.startswith('var/www/nikita-site/'):
            rel=name.removeprefix('var/www/nikita-site/')
            allowed=allowed and (rel in {'index.html','style.css','app.js'} or (rel.startswith('vendor/') and p.suffix in {'.css','.js','.woff2'}))
        else:
            allowed=allowed and name.removeprefix('var/www/pi-web-card/') in {'home.html','robots.txt','share.html','pi-web-card-v2.png','pi-web-card-c83fed50.png','pi-web-install-graphite.png','pi-web-curl-graphite-v4.png'}
    if name.startswith('var/lib/'):
        rel=name.removeprefix('var/lib/nikita-live-archive/')
        allowed=allowed and (rel in READ_UI or (rel.startswith('assets/katex/') and p.suffix in ('.css','.js','.woff2')))
    if p.suffix=='.json' and name not in JSON:allowed=False
    if not allowed:raise ValueError('Instance content is not public software: '+name)
