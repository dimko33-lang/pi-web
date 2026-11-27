#!/usr/bin/env python3
"""Detached startup rollback. Never snapshots/restores credentials or conversations."""
import ast
import fcntl
from pathlib import Path
import shutil
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parent
FILES = ('agent_server.py','agent_runtime.py','lc_recovery.py','piweb_recall.py','telegram_search.py','model_settings.py','recent_context.py','lightcone_context.py','lightcone_archive.py','debri_archive.py','rich_replies.py','telegram_blocks.py','lightcone-agent.md','agent_tools.ts','approval_state.py',
         'conversation_profiles.py','image_delivery.py','tool_policy.py','tool-policy.json','reply_delivery.py','public_site.py','character.md','working-rules.md','channel-agent.md','owner-agent.md','guest-agent.md','live_archive.py','telegraph_publish.py')


def cmd(*args):
    return subprocess.run(args,capture_output=True,text=True,timeout=30)


def good():
    before = cmd('systemctl','show','-p','MainPID','--value','tg-agent').stdout.strip()
    time.sleep(8)
    after = cmd('systemctl','show','-p','MainPID','--value','tg-agent').stdout.strip()
    if before in ('','0') or before != after or cmd('systemctl','is-active','--quiet','tg-agent').returncode:
        return False
    try:
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.settimeout(3)
            client.connect(str(ROOT/'agent-bridge.sock'))
            client.sendall(b'{"token":"health-check-invalid"}\n')
            return b'error' in client.recv(2000)
    except OSError:
        return False


def main():
    with (ROOT/'restart.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        try:
            for name in FILES:
                if name.endswith('.py'): ast.parse((ROOT/name).read_text())
        except Exception:
            return 1  # Leave current running process untouched on syntax failure.
        last = ROOT/'last-good'
        cmd('systemctl','restart','tg-agent')
        if good():
            last.mkdir(exist_ok=True)
            for name in FILES: shutil.copy2(ROOT/name,last/name)
            (ROOT/'restart-result.txt').write_text('Restart successful.\n')
            return 0
        for name in FILES:
            if not (last/name).is_file():
                (ROOT/'restart-result.txt').write_text('Startup failed; known-good source missing. Manual recovery needed.\n')
                return 1
        for name in FILES: shutil.copy2(last/name,ROOT/name)
        cmd('systemctl','restart','tg-agent')
        ok = good()
        (ROOT/'restart-result.txt').write_text('Startup failed; previous known-good sources restored. Recovery '+('successful' if ok else 'failed')+'.\n')
        return 0 if ok else 1


if __name__=='__main__': raise SystemExit(main())
