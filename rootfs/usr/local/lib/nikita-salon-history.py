"""Owner-only archive of outgoing Telegram messages. Never index incoming text."""
import asyncio, json, mimetypes, os, shutil, sqlite3, tempfile
from pathlib import Path
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument
from config import API_ID, API_HASH
from circle_transcripts import sql_reader, lookup
receipt = sql_reader(Path.cwd()/'users')

ROOT=Path('/var/lib/nikita-salon-history'); AUTHOR=@@ACCOUNT_ID@@; OWNER=@@OWNER_ID@@
GROUPS={-@@PROJECT_PEER@@:'piwep', -@@LAB_PEER@@:'curvelab', -@@ARRI_PEER@@:'arri', -@@LC_PEER@@:'lightcone', -@@LAKE_PEER@@:'lake'}
KEYS=(*GROUPS.values(),'owner_dm','guest_dm')

def atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        f.write(data); os.fchmod(f.fileno(),0o644)
    os.replace(f.name,path)

async def main():
    for k in KEYS: (ROOT/k).mkdir(exist_ok=True)
    db=sqlite3.connect(ROOT/'index.sqlite');db.executescript('CREATE TABLE IF NOT EXISTS items(peer INTEGER, id INTEGER, section TEXT, stamp INTEGER, payload TEXT, original TEXT, PRIMARY KEY(peer,id)); CREATE TABLE IF NOT EXISTS cursors(peer INTEGER PRIMARY KEY, id INTEGER); CREATE INDEX IF NOT EXISTS by_section ON items(section,stamp);')
    def export(k):
        records=[]
        for peer,mid,payload in db.execute('SELECT peer,id,payload FROM items WHERE section=? ORDER BY stamp DESC,id DESC',(k,)):
            row=json.loads(payload)
            if not row.get('text') and row.get('kind')=='mp4':
                original=json.loads(db.execute('SELECT original FROM items WHERE peer=? AND id=?',(peer,mid)).fetchone()[0]); source=(original.get('reply_to') or {}).get('reply_to_msg_id')
                if original.get('out') and type(source) is int:
                    text=receipt(peer,mid,source)
                    if text:
                        row['text']=text;db.execute('UPDATE items SET payload=? WHERE peer=? AND id=?',(json.dumps(row,ensure_ascii=False),peer,mid))
            records.append(row)
        db.commit();atomic(ROOT/k/'messages.json',json.dumps(records,ensure_ascii=False).encode())
    for k in KEYS: export(k)
    client=TelegramClient(StringSession(Path('send.string').read_text().strip()), API_ID, API_HASH)
    await client.connect()
    try:
        me=await client.get_me();assert me and me.id==AUTHOR
        dialogs=await client.get_dialogs();dialogs.sort(key=lambda d:(d.id not in GROUPS and d.id!=OWNER,))
        for d in dialogs:
            if d.id in GROUPS: key=GROUPS[d.id]
            elif d.is_user and d.id not in (AUTHOR,777000): key='owner_dm' if d.id==OWNER else 'guest_dm'
            else: continue
            cursor=db.execute('SELECT id FROM cursors WHERE peer=?',(d.id,)).fetchone(); start=cursor[0] if cursor else 0
            count=0
            async for m in client.iter_messages(d.entity,min_id=start,reverse=True,from_user=me):
                if m.sender_id!=AUTHOR or m.chat_id!=d.id or not m.out: continue
                stamp=int(m.date.timestamp()); identity=f'{abs(d.id)}-{m.id}'; r={'key':identity,'original':{'id':m.id,'date_unixtime':stamp},'text':m.raw_text or lookup(m,receipt)}
                if d.id in GROUPS:r['link']=f'https://t.me/c/{str(abs(d.id))[3:]}/{m.id}'
                if isinstance(m.media,(MessageMediaPhoto, MessageMediaDocument)):
                    f=m.file; mime='image/jpeg' if isinstance(m.media,MessageMediaPhoto) else (f.mime_type or 'application/octet-stream');ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','audio/ogg':'ogg'}.get(mime,'bin');name=identity+'.'+ext;p=ROOT/key/name
                    if not p.exists():
                        if shutil.disk_usage(ROOT).free < (f.size or 0)+3*1024**3: raise RuntimeError('Archive disk reserve reached')
                        tmp=p.with_suffix('.part');await client.download_media(m,file=str(tmp));os.chmod(tmp,0o644);os.replace(tmp,p)
                    r.update(file=name,kind=ext,filename=f.name or name)
                elif m.media and not r['text']: r['text']=type(m.media).__name__.removeprefix('MessageMedia')
                db.execute('INSERT OR REPLACE INTO items VALUES(?,?,?,?,?,?)',(d.id,m.id,key,stamp,json.dumps(r,ensure_ascii=False),m.to_json()));db.execute('INSERT OR REPLACE INTO cursors VALUES(?,?)',(d.id,m.id));db.commit();count+=1
                if count%50==0:export(key)
            if count: export(key)
        print(dict(db.execute('SELECT section,count(*) FROM items GROUP BY section')))
    finally: await client.disconnect();db.close()
asyncio.run(main())
