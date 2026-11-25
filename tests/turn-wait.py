"""Pi stream watchdog tests; --long additionally runs real Pi past the old 360 s deadline on loopback."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
from turn_wait import collect_pi, idle_seconds, PiIdleTimeout, reap_pi

FINAL = "print(json.dumps({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[{'type':'text','text':'Complete answer'}]}}));print(json.dumps({'type':'agent_settled'}))"
PROGRESS = "print(json.dumps({'type':'message_update','assistantMessageEvent':{'type':'thinking_delta','delta':'private scratch'}}),flush=True)"


class Watchdog(unittest.IsolatedAsyncioTestCase):
    async def child(self, code):
        return await asyncio.create_subprocess_exec(sys.executable, '-u', '-c', 'import sys,json,time;sys.stdin.read();'+code,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True)

    def test_configuration(self):
        with patch.dict(os.environ, clear=True):
            self.assertEqual(idle_seconds(), 1200)
            for s in ['0', '1', '3600']:
                os.environ['NIKITA_PI_IDLE_SECONDS']=s; self.assertEqual(idle_seconds(), int(s))
            for s in ['', 'off', '-1', 'nan']:
                os.environ['NIKITA_PI_IDLE_SECONDS']=s; self.assertRaises(ValueError, idle_seconds)

    async def test_long_active_and_zero(self):
        for idle, code in [(0.6,'\nfor i in range(10): '+PROGRESS+';time.sleep(.13)\n'), (0,'time.sleep(.65);')]:
            proc = await self.child(code+FINAL)
            try: answer = await collect_pi(proc, 'Test', idle=idle)
            finally: await reap_pi(proc)
            self.assertTrue(answer.settled); self.assertEqual(answer.text, 'Complete answer'); self.assertIsNone(answer.failed)

    async def test_settled_text_does_not_hide_an_earlier_tool_action(self):
        for event in ({'type':'tool_execution_start'}, {'type':'message_end','message':{'role':'assistant','content':[{'type':'toolCall'}]}}):
            proc = await self.child('print('+repr(json.dumps(event))+');'+FINAL)
            try: answer = await collect_pi(proc,'Q',idle=2)
            finally: await reap_pi(proc)
            self.assertTrue(answer.used_tools and answer.settled); self.assertEqual(answer.text,'Complete answer')

    async def test_stall_and_cancel(self):
        for cancel in (False, True):
            proc = await self.child(PROGRESS+';time.sleep(20)')
            task = asyncio.create_task(collect_pi(proc,'Test',idle=0 if cancel else .35))
            try:
                if cancel:
                    await asyncio.sleep(.1);task.cancel()
                    with self.assertRaises(asyncio.CancelledError): await task
                else:
                    with self.assertRaisesRegex(PiIdleTimeout, 'no progress for 0.35 seconds'): await task
            finally: await asyncio.wait_for(reap_pi(proc), 3)
            self.assertIsNotNone(proc.returncode)

    async def test_failed_and_incomplete_output(self):
        proc = await self.child(FINAL.replace("'stop'", "'length'"))
        try: answer = await collect_pi(proc, '', idle=2)
        finally: await reap_pi(proc)
        self.assertIn('Complete answer', answer.text); self.assertIn('output limit', answer.text)
        proc = await self.child(PROGRESS+';sys.stderr.write("x"*16000);sys.exit(1)')
        try: answer = await collect_pi(proc, '', idle=2)
        finally: await reap_pi(proc)
        self.assertFalse(answer.text or answer.settled); self.assertEqual(len(answer.stderr),4000); self.assertEqual(proc.returncode,1)


def long_turn(pi):
    """Synthetic reasoning events only, no Telegram login, provider credential or session reuse."""
    import instance
    seen = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*a): pass
        def do_POST(self):
            if self.headers.get('Authorization')!='Bearer local-test': self.send_error(401); return
            seen.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            def emit(delta, reason=None):
                packet={'id':'slow','object':'chat.completion.chunk','model':'slow','choices':[{'index':0,'delta':delta,'finish_reason':reason}]}
                self.wfile.write(('data: '+json.dumps(packet)+'\n\n').encode()); self.wfile.flush()
            emit({'role':'assistant'});start=time.monotonic()
            while time.monotonic()-start<365:
                emit({'reasoning_content':'Think. '}); time.sleep(5)
            emit({'content':'Complete answer after six minutes'});emit({},'stop');self.wfile.write(b'data: [DONE]\n\n')
    server = ThreadingHTTPServer(('127.0.0.1',0), Provider); thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);agent=root/'agent';state=root/'state';agent.mkdir();state.mkdir()
            (agent/'models.json').write_text(json.dumps({'providers':{'fixture':{'api':'openai-completions','baseUrl':f'http://127.0.0.1:{server.server_port}/v1','models':[{'id':'slow','name':'Slow fixture','reasoning':True,'contextWindow':100000,'maxTokens':2048}]}}}))
            (agent/'auth.json').write_text(json.dumps({'fixture':{'type':'api_key','key':'local-test'}}))
            env={'HOME':tmp,'PI_WEB_PI_BIN':pi,'PI_CODING_AGENT_DIR':str(agent),'NIKITA_PI_IDLE_SECONDS':'25'}
            with patch.dict(os.environ,env), patch.object(instance,'BASE',state):
                start=time.monotonic();text=asyncio.run(instance.answer('Synthetic timing check',{'memory':False,'model':'fixture/slow','toolsOn':False,'thinking':'high'}));elapsed=time.monotonic()-start
            assert elapsed>360 and text=='Complete answer after six minutes' and len(seen)==1
            print(f'{elapsed:.1f}s, one actual Pi provider request, reasoning-only progress, final answer intact (25s idle watchdog).')
    finally: server.shutdown();server.server_close();thread.join()


if __name__=='__main__':
    if sys.argv[1:]==['--long']: long_turn(os.environ['TEST_PI_BIN'])
    else: unittest.main()
