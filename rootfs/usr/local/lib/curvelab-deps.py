"""Socket-activated TLS tunnel to public development registries; no credentials."""
import sys,os,socket,ipaddress,select,re
c=socket.socket(fileno=os.dup(0));c.settimeout(8);header=b''
while b'\r\n\r\n' not in header and len(header)<8192:
    chunk=c.recv(2048)
    if not chunk: sys.exit(0)
    header+=chunk
m=re.fullmatch(rb'CONNECT ([A-Za-z0-9.-]+):443 HTTP/1\.[01]',header.split(b'\r\n',1)[0]);h=m[1].decode().lower() if m else ''
allow=('registry.npmjs.org','deb.debian.org','pypi.org','files.pythonhosted.org','github.com','codeload.github.com','raw.githubusercontent.com','objects.githubusercontent.com','release-assets.githubusercontent.com','figma.com','www.figma.com','desktop.figma.com')
if h not in allow:c.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');sys.exit(0)
addr=next(a[4][0] for a in socket.getaddrinfo(h,443,socket.AF_INET,socket.SOCK_STREAM) if ipaddress.ip_address(a[4][0]).is_global);s=socket.create_connection((addr,443),8);c.sendall(b'HTTP/1.1 200 Connection established\r\n\r\n');s.settimeout(15);c.settimeout(15)
while True:
    ready=select.select([c,s],[],[],45)[0]
    if not ready:break
    for a in ready:
        data=a.recv(32768)
        if not data:sys.exit(0)
        (s if a is c else c).sendall(data)
