"""Fresh-instance inputs for the reference services. No production data or network calls."""
import ipaddress
import json
import re
import secrets
from prepare import bindings, load, META

TG='/srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent'
B='/srv/pi-workspaces/browser/rootfs'
APP=B+'/opt/pi-web'
DATA='/srv/pi-workspaces/nikita/rootfs/opt/pi-web/data'
STATE='/var/lib/pi-web-installer'
RELEASE='/opt/pi-web-release-0.14.0'
GROUPS=[('piwep','Pi Web','PROJECT_PEER','tailPiwep'),('curvelab','CurveLab','LAB_PEER',''),('arri','ARRI','ARRI_PEER',''),('lightcone','LightCone','LC_PEER','tailLightcone'),('lake','Lake','LAKE_PEER',''),('moisimeiz','Simeiz','SIMEIZ_PEER',''),('salon_nikita','Salon','SALON_PEER','')]

def domain_name(domain,ip):
    if not domain:
        try:addr=ipaddress.IPv4Address(ip)
        except ValueError:raise ValueError('Set PI_WEB_DOMAIN or PI_WEB_PUBLIC_IP for this server') from None
        if not addr.is_global:raise ValueError('Public IPv4 or an explicit PI_WEB_DOMAIN required')
        domain=str(addr).replace('.','-')+'.sslip.io'
    if len(domain)>190 or '.' not in domain or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',p) for p in domain.split('.')):raise ValueError('Invalid base DNS name')
    return domain

def new_instance(domain,override=None):
    schema=load(META/'bindings.json');raw={}; hosts={'SITE_HOST':domain,'SITE_WWW':'www.'+domain,'PANEL_HOST':'panel.'+domain,'EDITOR_HOST':'editor.'+domain,'EDITOR_WWW':'www.editor.'+domain,'ARRI_HOST':'arri.'+domain,'PUBLIC_HOST':'pi.'+domain,'FORMER_PANEL_HOST':'panel.'+domain}
    for i,(k,t) in enumerate(schema.items()):
        if t in ('derived','venv-instance'):continue
        if t=='host':v=hosts[k]
        elif t=='integer':v=str(1008000000000000+i)  # Unbound; never authorize the Telegram runtime with these values.
        elif t.startswith('hex'):v=secrets.token_hex(int(t[3:])//2)
        elif t=='secret64':v=secrets.token_hex(32)
        elif t=='access-token':v=secrets.token_urlsafe(32)
        elif t=='label':v='Owner'
        elif t=='identifier':v='unbound_'+secrets.token_hex(10)
        else:raise ValueError('Unexpected binding kind: '+t)
        raw[k]=v
    if override is not None:
        if not isinstance(override,dict) or set(override)-set(raw):raise ValueError('Unknown private binding')
        raw.update(override)
    values=bindings(schema,raw)
    names=[values[k] for k in hosts if k!='FORMER_PANEL_HOST']
    if len(names)!=len(set(names)):raise ValueError('TLS virtual hosts must be distinct')
    return {'bindings':raw,'panelPassword':secrets.token_urlsafe(32),'entryKey':secrets.token_urlsafe(32),'editorPassword':secrets.token_urlsafe(32)}

def catalog(v):
    return [{'id':slug,'label':label,'kind':'group','chatId':-int(v[key]),'tailKey':tail,'backgroundLimit':100} for slug,label,key,tail in GROUPS]+[{'id':'owner_dm','label':'My DM','kind':'private','chatId':int(v['OWNER_ID']),'tailKey':'tailDirect'},{'id':'guest_dm','label':'Guest DM','kind':'private_default','tailKey':'tailDirect'}]

def seeds(cfg):
    """(path, bytes, mode, user, group) for a NEW instance; never migrations."""
    v=cfg['bindings']; out={}
    def put(p,s,mode=0o600,u='root',g='root'):
        out[p]=((s if isinstance(s,str) else json.dumps(s,ensure_ascii=False))+'\n',mode,u,g)
    put(B+'/etc/pi-web.env','PI_WEB_PASSWORD='+cfg['panelPassword'])
    put(B+'/etc/site-entry.json',{'key':cfg['entryKey'],'apps':[{'path':'/','url':'http://127.0.0.1:5670/','key':cfg['panelPassword'],'cookie':'cl_sid','check':'/api/settings'}]},0o640,'root','pi-browser')
    put('/etc/curvelab-editor.env','EDITOR_BASE_PATH=/\nPORT=5080\nEDITOR_PUBLIC_VIEW=1\nEDITOR_PASSWORD='+cfg['editorPassword'])
    # 95-browser-admin resets EnvironmentFile=; load the private catalog AFTER that reset.
    put('/etc/systemd/system/pi-nikita.service.d/99-instance-catalog.conf','[Service]\nEnvironmentFile=/etc/pi-web-instance/profile-catalog.env',0o644)
    put('/etc/pi-web-instance/profile-catalog.env',"PI_WEB_CONVERSATION_TITLE=Conversations\nPI_WEB_CONVERSATION_PROFILES='"+json.dumps(catalog(v),separators=(',',':'))+"'")
    put(B+'/etc/browser-system.txt','',0o640,'root','pi-browser');put(APP+'/data/sessions.json',{},0o600,'pi-browser','pi-browser');put('/var/lib/pi-browser-admin/state.json',{'root':False})
    for n in ['working-rules.md','character.md','assistant-system.txt','channel-agent.md','owner-agent.md','guest-agent.md','lightcone-agent.md','AGENTS.md']:
        put(TG+'/'+n,'',0o640,'pi-nikita','pi-nikita')
    put(DATA+'/settings.json',{},0o660,'pi-nikita','pi-nikita')
    put(DATA+'/addressing.json',{'names':['Никита','Ника','Ники'],'chatModes':{}},0o660,'pi-nikita','pi-nikita')
    put(DATA+'/conversation-profiles.json',{'version':1,'revision':0,'profiles':{}},0o660,'pi-nikita','pi-nikita')
    for n in ('index.json','index.owner.json'):put('/var/lib/nikita-publications/'+n,[],0o644,'pi-nikita','pi-nikita')
    history='/var/lib/nikita-salon-history';author='user'+v['ACCOUNT_ID'];feed={'author':{'id':author},'messages':[]}
    for n in ['piwep','lightcone','curvelab','arri','lake','owner_dm','guest_dm']:put(history+'/'+n+'/messages.json',[],0o644,'pi-nikita','pi-nikita')
    for p in ['/var/lib/nikita-salon-piwep/messages.json','/var/lib/nikita-salon-piwep/lightcone/messages.json','/var/lib/nikita-live-archive/messages/'+author+'.json']:put(p,feed,0o644,'pi-nikita','pi-nikita')
    put('/var/lib/nikita-live-archive/authors.json',[{'id':author,'display_name':'Nikita','type':'user','message_count':0,'file':'messages/'+author+'.json'}],0o644,'pi-nikita','pi-nikita')
    for name,release in [('debri-reader','20261112T205217Z'),('lightcone-reader','20261112T214655Z')]:put('/opt/projects/'+name+'/releases/'+release+'/public/authors.json',[],0o644)
    # Do not start a copied Telegram identity. The operator enrolls an independent
    # account or makes an exclusive handoff, then explicitly enables these units.
    for name in ('tg-agent.service','nikita-restart.service','nikita-salon-history.service','nikita-salon-piwep.service'):
        put('/etc/systemd/system/'+name+'.d/99-enrollment.conf','[Unit]\nConditionPathExists=/etc/pi-web-instance/telegram-enrolled',0o644)
    return out
