#!/usr/bin/env python3
"""Exercise the locked Pi with real extensions and only synthetic loopback peers."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import runpy
import socketserver
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1] / 'rootfs'
TG = ROOT / 'srv/pi-workspaces/nikita/rootfs/opt/projects/tg-agent'
PANEL = ROOT / 'srv/pi-workspaces/browser/rootfs/opt/pi-web/server'
MODEL = 'fixture/test'
PROMPT = 'Fixture instructions.'
ANSWER = 'Fixture response.'


@contextmanager
def serving(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def checks(pi, tmp):
    pin = json.loads((ROOT.parent / 'deployment/platform.json').read_bytes())['pi']
    assert subprocess.check_output([pi, '--version'], text=True, cwd=tmp, env={'PATH': os.environ['PATH'], 'HOME': str(tmp), 'PI_OFFLINE': '1'}).strip() == pin
    seen, calls, captures = [], [], []
    requested = None

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.path == '/api/vision/capture':
                assert self.headers['Authorization'] == 'Bearer fixture-vision'
                captures.append(data)
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'target': 'chat', 'source': 'fixture', 'mimeType': 'image/png', 'data': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0V8AAAAASUVORK5CYII='}).encode()); return
            assert self.path == '/v1/chat/completions'
            seen.append(data)
            if requested and len(seen) == 1:
                name, params = requested
                delta = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'call_fixture', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(params)}}]}
                stop = 'tool_calls'
            else:
                delta, stop = {'role': 'assistant', 'content': ANSWER}, 'stop'
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            for chunk, reason in ((delta, None), ({}, stop)):
                event = {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': 'test', 'choices': [{'index': 0, 'delta': chunk, 'finish_reason': reason}]}
                self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')

    class Broker(socketserver.StreamRequestHandler):
        def handle(self):
            calls.append(json.loads(self.rfile.readline()))
            self.wfile.write(b'{"content":[{"type":"text","text":"Fixture page."}]}')

    policy = json.loads((TG / 'tool-policy.json').read_bytes())
    collect = runpy.run_path(str(TG / 'turn_wait.py'))['collect_pi']
    broker_path = str(tmp / 'broker.sock')
    with serving(ThreadingHTTPServer(('127.0.0.1', 0), Provider)) as server, serving(socketserver.UnixStreamServer(broker_path, Broker)):
        endpoint = 'http://127.0.0.1:' + str(server.server_port)
        agent = tmp / 'agent'; agent.mkdir()
        (tmp / 'prompt').write_text(PROMPT)
        (agent / 'models.json').write_text(json.dumps({'providers': {'fixture': {'baseUrl': endpoint + '/v1', 'apiKey': 'fixture', 'api': 'openai-completions', 'models': [{'id': 'test', 'name': 'Fixture', 'input': ['text', 'image'], 'contextWindow': 64000, 'maxTokens': 512}]}}}))
        env = {'PATH': os.environ['PATH'], 'HOME': str(tmp), 'PI_CODING_AGENT_DIR': str(agent), 'PI_OFFLINE': '1', 'NO_COLOR': '1'}
        base = [str(pi), '--print', '--mode', 'json', '--model', MODEL, '--thinking', 'off', '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates']
        for role in [k for k in policy if k != 'common'] + ['project', 'disabled']:
            seen.clear(); actual = 'public_research' if role == 'project' else 'guest' if role == 'disabled' else role
            expected = set(policy['common'] + policy[actual]) if role != 'disabled' else set()
            if role == 'project': expected.add('project_command')
            requested = ('web_read', {'url': 'https://fixture.invalid/'}) if role == 'guest' else None
            args = base + ['--no-session', '--no-mcp', '--no-approve', '--extension', str(TG / 'agent_tools.ts'), '--system-prompt', 'Base.', '--tools', ','.join(sorted(expected))]
            if actual != 'owner': args += ['--no-builtin-tools']
            tg_env = {**env, 'NIKITA_ROLE': actual, 'NIKITA_TOOLS_ENABLED': '0' if role == 'disabled' else '1', 'NIKITA_APP_PROJECT': '1' if role == 'project' else '0', 'NIKITA_TOKEN': 'fixture', 'NIKITA_SOCKET': broker_path, 'NIKITA_SYSTEM_FILE': str(tmp / 'prompt')}

            async def turn():
                pipe = asyncio.subprocess.PIPE
                proc = await asyncio.create_subprocess_exec(*args, stdin=pipe, stdout=pipe, stderr=pipe, cwd=tmp, env=tg_env, start_new_session=True)
                try: return await collect(proc, 'Test.', idle=20)
                finally:
                    if proc.returncode is None: proc.kill(); await proc.wait()
            reply = asyncio.run(turn())
            assert reply.text == ANSWER and reply.settled and not reply.failed and reply.used_tools == bool(requested), (role, reply)
            names = {t['function']['name'] for t in seen[0].get('tools', [])}
            assert names == expected, (role, names ^ expected)
            assert seen[0]['messages'][0]['content'] == PROMPT
            if requested:
                assert calls == [{'token': 'fixture', 'action': requested[0], 'params': requested[1]}]
                assert 'Fixture page.' in json.dumps(seen[1]['messages'])

        requested = ('capture_workspace', {'target': 'chat'}); seen.clear()
        args = base + ['--approve', '--session-id', '01234567-0000-4000-a000-000000000001', '--session-dir', str(tmp / 'sessions'), '--extension', str(PANEL / 'pi-vision.ts'), '--extension', str(PANEL / 'pi-context-extension.ts'), '--system-prompt', PROMPT, 'Test.']
        result = subprocess.run(['bash', '-c', 'exec 3>context.jsonl; exec "$@"', 'fixture', *args], env={**env, 'PI_WEB_CONTEXT_FD': '3', 'PI_WEB_VISION_ENDPOINT': endpoint + '/api/vision/capture', 'PI_WEB_VISION_TOKEN': 'fixture-vision'}, cwd=tmp, check=True, capture_output=True, timeout=30)
        events = list(map(json.loads, result.stdout.splitlines()))
        assert captures == [{'target': 'chat'}]
        assert any(e['type'] == 'message_update' and e.get('assistantMessageEvent', {}).get('delta') == ANSWER for e in events)
        assert any(e['type'] == 'tool_execution_end' and not e.get('isError') and any(c['type'] == 'image' for c in e['result']['content']) for e in events)
        assert any(e['model'] == MODEL and e['usage']['contextWindow'] == 64000 for e in map(json.loads, (tmp / 'context.jsonl').read_text().splitlines()) if e['usage'])
        sdk = pi.resolve().parents[2] / 'dist/index.js'
        file, = (tmp / 'sessions').rglob('*.jsonl')
        def reader(operation, model=MODEL):
            args = {'sdkEntry': str(sdk), 'cwd': str(tmp), 'agentDir': str(agent), 'modelId': model, 'operation': operation, 'file': str(file)}
            result = subprocess.run(['node', str(PANEL / 'pi-context-reader.mjs')], input=json.dumps(args), text=True, env=env, cwd=tmp, capture_output=True, check=True, timeout=20)
            return json.loads(result.stdout)
        assert reader('thinking')['levels'] and reader('context')['contextWindow'] == 64000
        for model in json.loads((PANEL.parent / 'models.json').read_bytes()):
            metadata = reader('thinking', model)
            assert metadata['defaultLevel'] in metadata['levels'], model
        # Same internal SDK entry points as the panel's /pi-reference route.
        subprocess.run(['node', '--input-type=module', '-e', '''
            const core = process.argv[1];
            const { buildSystemPrompt } = await import(core + '/system-prompt.js');
            const { createCodingToolDefinitions } = await import(core + '/tools/index.js');
            const cwd = process.cwd(), tools = createCodingToolDefinitions(cwd);
            if (!tools.length || !buildSystemPrompt({cwd, selectedTools: tools.map(t => t.name)}).trim()) process.exit(1);
        ''', (sdk.parent / 'core').as_uri()], cwd=tmp, env=env, check=True, timeout=20)
    print('Pi contracts passed: Telegram roles, project, tools off, broker round trip and reply parser; browser capture, streaming, session, FD 3 usage and offline SDK.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pi', type=Path, help='node_modules/.bin/pi from a clean npm ci of the runtime lock')
    cli = parser.parse_args().pi.absolute()
    with tempfile.TemporaryDirectory(dir='/tmp') as tmp:
        checks(cli, Path(tmp))
