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
RELEASE='/opt/pi-web-release-0.14.3'
DEFAULTS=META/'reference-defaults.json'

def domain_name(domain,ip):
    if not domain:
        try:addr=ipaddress.IPv4Address(ip)
        except ValueError:raise ValueError('Set PI_WEB_DOMAIN or PI_WEB_PUBLIC_IP for this server') from None
        if not addr.is_global:raise ValueError('Public IPv4 or an explicit PI_WEB_DOMAIN required')
        domain=str(addr).replace('.','-')+'.sslip.io'
    if len(domain)>190 or '.' not in domain or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',p) for p in domain.split('.')):raise ValueError('Invalid base DNS name')
    return domain

def new_instance(domain,override=None,*,test_label=None):
    schema=load(META/'bindings.json');raw={}; hosts={'SITE_HOST':domain,'SITE_WWW':'www.'+domain,'PANEL_HOST':'panel.'+domain,'EDITOR_HOST':'editor.'+domain,'EDITOR_WWW':'www.editor.'+domain,'ARRI_HOST':'static.'+domain,'PUBLIC_HOST':'pi.'+domain,'FORMER_PANEL_HOST':'panel.'+domain}
    for i,(k,t) in enumerate(schema.items()):
        if t in ('derived','venv-instance'):continue
        if t=='host':v=hosts[k]
        elif t=='integer':v=None  # No peer exists until explicit enrollment.
        elif t.startswith('hex'):v=secrets.token_hex(int(t[3:])//2)
        elif t=='secret64':v=secrets.token_hex(32)
        elif t=='access-token':v=secrets.token_urlsafe(32)
        elif t=='label':v='Owner'
        elif t=='identifier':v='-'  # Not a Telegram handle, avatar or local authority.
        else:raise ValueError('Unexpected binding kind: '+t)
        raw[k]=v
    # Production uses the reviewed catalog as-is. An unresolved private source cannot be installed.
    label=next(e['label'] for e in load(DEFAULTS)['catalog'] if e['id']=='individual_dm') or test_label
    if not isinstance(label,str) or not (0<len(label)<=80 and all(c.isalpha() or c in ' -.' for c in label) and label==label.strip()):raise ValueError('Unresolved personal tab label: use the reviewed package, never invent or omit a tab')
    person=None
    if isinstance(override,dict):
        override=override.copy();person=override.pop('PERSONAL_DM_ID',None)
        if person is not None and (not isinstance(person,str) or not re.fullmatch('[1-9][0-9]{0,15}',person) or int(person)>=2**53):raise ValueError('Invalid private DM binding')
    if override is not None:
        if not isinstance(override,dict) or set(override)-set(raw):raise ValueError('Unknown private binding')
        raw.update(override)
    values=bindings(schema,raw)
    names=[values[k] for k in hosts if k!='FORMER_PANEL_HOST']
    if len(names)!=len(set(names)):raise ValueError('TLS virtual hosts must be distinct')
    if person and person in (raw['OWNER_ID'],raw['ACCOUNT_ID']):raise ValueError('Duplicate private identity')
    return {'bindings':raw,'personalLabel':label,'personalPeer':person,'panelPassword':secrets.token_urlsafe(32),'entryKey':secrets.token_urlsafe(32)}

def catalog(cfg):
    entries=load(DEFAULTS)['catalog']; peers={**cfg['bindings'],'PERSONAL_DM_ID':cfg['personalPeer']}
    for e in entries:
        peer=peers.get(e.pop('binding',None));e['chatId']=(-1 if e['kind']=='group' else 1)*int(peer) if peer else None
        if e['id']=='individual_dm':
            e['label']=cfg['personalLabel']
            if peer:e['id']='dm_'+peer
    return entries

def seeds(cfg):
    """(path, bytes, mode, user, group) for a NEW instance; never migrations."""
    v=bindings(load(META/'bindings.json'),cfg['bindings']); out={}
    source=load(DEFAULTS);slots=catalog(cfg)
    def resolve(obj):
        if isinstance(obj,str):return re.sub(r'@@([A-Z_0-9]+)@@',lambda m:v[m[1]],obj)
        if isinstance(obj,dict):return {k:resolve(x) for k,x in obj.items()}
        return obj
    def raw(p,text,mode,u,g):out[p]=(text,mode,u,g)
    def put(p,s,mode=0o600,u='root',g='root'):
        out[p]=((s if isinstance(s,str) else json.dumps(s,ensure_ascii=False))+'\n',mode,u,g)
    views={e['id']:p['chatId'] for e,p in zip(source['catalog'],slots) if e['id'] in ('moisimeiz','salon_nikita','individual_dm')}
    views['individual']=views.pop('individual_dm');put('/etc/nikita-history-views.json',views,0o640,'root','pi-nikita')
    put(B+'/etc/pi-web.env','PI_WEB_PASSWORD='+cfg['panelPassword'])
    put(B+'/etc/site-entry.json',{'key':cfg['entryKey'],'apps':[{'path':'/','url':'http://127.0.0.1:5670/','key':cfg['panelPassword'],'cookie':'cl_sid','check':'/api/settings'}]},0o640,'root','pi-browser')
    # 95-browser-admin resets EnvironmentFile=; load the private catalog AFTER that reset.
    put('/etc/systemd/system/pi-nikita.service.d/99-instance-catalog.conf','[Service]\nEnvironmentFile=/etc/pi-web-instance/profile-catalog.env',0o644)
    put('/etc/pi-web-instance/profile-catalog.env',"PI_WEB_CONVERSATION_TITLE="+source['title']+"\nPI_WEB_CONVERSATION_PROFILES='"+json.dumps(slots,separators=(',',':'))+"'")
    raw(B+'/etc/browser-system.txt',source['browserSystem'],0o640,'root','pi-browser');put(APP+'/data/sessions.json',{},0o600,'pi-browser','pi-browser');put('/var/lib/pi-browser-admin/state.json',{'root':False})
    for n,s in source['roleFiles'].items():raw(TG+'/'+n,resolve(s),0o640,'pi-nikita','pi-nikita')
    for root,prefix,model,thinking,settings,u in [(APP+'/data','browser','browser-model.txt','browser-thinking.json','browser-settings.json','pi-browser'),(DATA,'telegram','model.txt','chat-thinking.json','settings.json','pi-nikita')]:
        mode=0o660 if root==DATA else 0o600
        raw(root+'/'+model,source[prefix+'Model'],mode,u,u);put(root+'/'+thinking,source[prefix+'Thinking'],mode,u,u);put(root+'/'+settings,resolve(source[prefix+'Settings']),mode,u,u)
    profiles={p['id']:resolve(source['profiles'][e['id']]) for p,e in zip(slots,source['catalog'])}
    modes={str(p['chatId']):source['addressModes'][p['id']] for p in slots if p['chatId'] and p['id'] in source['addressModes']}
    put(DATA+'/addressing.json',{'names':source['addressNames'],'chatModes':modes},0o660,'pi-nikita','pi-nikita')
    put(DATA+'/conversation-profiles.json',{'version':1,'revision':0,'profiles':profiles},0o660,'pi-nikita','pi-nikita')
    for n in ('index.json','index.owner.json'):put('/var/lib/nikita-publications/'+n,[],0o644,'pi-nikita','pi-nikita')
    history='/var/lib/nikita-salon-history';author=('user'+v['ACCOUNT_ID']) if cfg['bindings']['ACCOUNT_ID'] else None
    feed={'author':{'id':author} if author else {},'messages':[]}
    for n in ['piwep','lightcone','curvelab','arri','lake','owner_dm','guest_dm']:put(history+'/'+n+'/messages.json',[],0o644,'pi-nikita','pi-nikita')
    for p in ['/var/lib/nikita-salon-piwep/messages.json','/var/lib/nikita-salon-piwep/lightcone/messages.json','/var/lib/nikita-live-archive/messages/'+(author or 'unbound')+'.json']:put(p,feed,0o644,'pi-nikita','pi-nikita')
    put('/var/lib/nikita-live-archive/authors.json',[],0o644,'pi-nikita','pi-nikita')
    if cfg['bindings']['OWNER_ID'] and cfg['bindings']['ACCOUNT_ID']:put('/etc/pi-web-instance/telegram-identity-bound','',0o600)
    for name in ('archive-a','archive-b'):put('/opt/projects/'+name+'/authors.json',[],0o644)
    # Do not start a copied Telegram identity. The operator enrolls an independent
    # account or makes an exclusive handoff, then explicitly enables these units.
    for name in ('tg-agent.service','nikita-restart.service','nikita-salon-history.service','nikita-salon-piwep.service'):
        put('/etc/systemd/system/'+name+'.d/99-enrollment.conf','[Unit]\nConditionPathExists=/etc/pi-web-instance/telegram-enrolled\nConditionPathExists=/etc/pi-web-instance/telegram-identity-bound',0o644)
    return out
