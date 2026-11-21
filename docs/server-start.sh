#!/bin/bash
# Run from the installation directory. Leave existing web servers untouched.
set -euo pipefail
umask 077
base=$1; os=$2; arch=$3; port=${PORT:-5070}; state="$base/remote-access"
mkdir -p "$state"; chmod 700 "$state"
if [[ -n ${PI_WEB_PUBLIC_HOST:-} ]]; then host=$PI_WEB_PUBLIC_HOST
else
  read -r client clientport ip serverport <<< "${SSH_CONNECTION:-}"
  if [[ ! $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo 'Set PI_WEB_PUBLIC_HOST to a public DNS name pointing to this server.' >&2; exit 1; fi
  host="${ip//./-}.sslip.io"
fi
[[ $host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9]+$ && $port =~ ^[0-9]{1,5}$ ]] || { echo 'Invalid host or port.' >&2; exit 1; }
url="https://$host"; ticket="$state/ticket.json"; version=2.11.9
# Check the certificate, exact instance and auth gate, never just the status of a public landing page.
protected(){ local headers; headers=$(curl -sS --noproxy '*' --max-time 4 -D - -o /dev/null "$1/profiles" 2>/dev/null) || return 1; grep -Eq '^HTTP/[^ ]+ 401' <<< "$headers" && tr -d '\r' <<< "$headers" | grep -Fxiq "x-pi-web-instance: $instance"; }
issue(){ local key; key=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))'); printf '%s' "$key" | node -e 'const f=require("fs"),p=process.argv[1],t=p+"."+process.pid; f.writeFileSync(t,JSON.stringify({key:f.readFileSync(0,"utf8"),until:Date.now()+600000}),{mode:0o600}); f.renameSync(t,p)' "$ticket"; printf '\nOpen Nikita (private, one use, valid for 10 minutes):\n%s/open#%s\n' "$url" "$key"; }
if [[ -r $state/instance ]]; then instance=$(<"$state/instance"); if protected "$url"; then issue; exit; fi; fi
# Refuse conflicts before downloading or requesting a certificate.
node - "$port" <<'JS'
const net=require('node:net'); (async()=>{for(const [port,host] of [[+process.argv[2],'127.0.0.1'],[80,'0.0.0.0'],[443,'0.0.0.0']]) await new Promise((ok,fail)=>{const s=net.createServer();s.on('error',e=>fail(Error(`Cannot listen on port ${port} (${e.code}). Existing services were not changed.`)));s.listen(port,host,()=>s.close(ok));});})().catch(e=>{console.error(e.message);process.exitCode=1});
JS
case "$os-$arch" in
linux-x64) platform=linux_amd64; sum=5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb;;
linux-arm64) platform=linux_arm64; sum=5e377cff994fc9362a6fcf695c53f226cfca3a3ef85bd3a3687cf252d6310165;;
darwin-x64) platform=mac_amd64; sum=22af256a2cc45606f6bfa8786cd89130529331319665926f4e972234a658fb30;;
darwin-arm64) platform=mac_arm64; sum=d075afc620376679a77b453399bf7ada264cab3280b2833e4ed1372abc0c1c13;;
esac
caddy="$state/caddy-$version"
if [[ ! -x $caddy ]]; then
  tmp=$(mktemp -d "$state/.download.XXXXXX"); trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 2 "https://github.com/caddyserver/caddy/releases/download/v$version/caddy_${version}_${platform}.tar.gz" -o "$tmp/archive"
  node -e 'const fs=require("fs"),h=require("crypto").createHash("sha256");fs.createReadStream(process.argv[1]).on("data",d=>h.update(d)).on("end",()=>{if(h.digest("hex")!==process.argv[2])throw Error("Caddy checksum mismatch")})' "$tmp/archive" "$sum"
  tar -xzf "$tmp/archive" -C "$tmp" caddy; chmod 700 "$tmp/caddy"; mv "$tmp/caddy" "$caddy"; rm -rf "$tmp"; trap - EXIT
fi
instance=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))'); printf '%s\n' "$instance" > "$state/instance"
export PI_WEB_INSTANCE="$instance" PI_WEB_ALLOWED_HOSTS="$host" PI_WEB_TICKET_FILE="$ticket" PORT="$port"
export PI_WEB_PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"; unset PI_WEB_PASSWORD_HASH; rm -f "$ticket"
export XDG_DATA_HOME="$state/data" XDG_CONFIG_HOME="$state/config"
printf '{\n admin off\n persist_config off\n}\n%s {\n reverse_proxy 127.0.0.1:%s\n}\n' "$host" "$port" > "$state/Caddyfile"
cd "$base/app"; app=; proxy=
cleanup(){ [[ -z $proxy ]] || kill "$proxy" 2>/dev/null || :; [[ -z $app ]] || kill "$app" 2>/dev/null || :; }; trap cleanup EXIT
nohup node --import tsx server/main.ts </dev/null >"$state/app.log" 2>&1 & app=$!
for ((i=0;i<30;i++)); do protected "http://127.0.0.1:$port" && break; kill -0 "$app" 2>/dev/null || break; sleep 1; done
protected "http://127.0.0.1:$port" || { echo "Application did not pass its private health check; see $state/app.log" >&2; exit 1; }
unset PI_WEB_PASSWORD
nohup "$caddy" run --adapter caddyfile --config "$state/Caddyfile" </dev/null >"$state/https.log" 2>&1 & proxy=$!
echo 'Preparing HTTPS. The server must be reachable on ports 80 and 443…'
for ((i=0;i<100;i++)); do
  if protected "$url"; then issue; trap - EXIT; exit 0; fi
  kill -0 "$proxy" 2>/dev/null || break; sleep 2
done
echo "HTTPS was not verified. No link issued. Check DNS, ports 80/443 and $state/https.log." >&2; exit 1
