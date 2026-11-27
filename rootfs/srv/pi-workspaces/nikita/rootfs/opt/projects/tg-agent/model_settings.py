"""Read Nikita panel model/thinking for each Telegram turn; never copy credentials."""
import asyncio
import json
from pathlib import Path

PANEL = Path('/srv/pi-workspaces/nikita/rootfs/opt/pi-web')
PANEL_HOME = Path('/srv/pi-workspaces/nikita/rootfs/root')
DEFAULT_MODEL = 'openai/gpt-6.1-sol'


def snapshot(panel=PANEL):
    def model_id():
        try:
            return (panel/'data/model.txt').read_text().strip() or DEFAULT_MODEL
        except FileNotFoundError:
            return DEFAULT_MODEL
    for _ in range(3):
        model = model_id()
        enabled = json.loads((panel/'models.json').read_text())
        if model not in enabled or '/' not in model:
            raise ValueError('В панели Никиты выбрана неизвестная модель: ' + model)
        try:
            saved = json.loads((panel/'data/chat-thinking.json').read_text())
        except FileNotFoundError:
            saved = {}
        if not isinstance(saved, dict):
            raise ValueError('Некорректные настройки размышлений в панели Никиты.')
        if model == model_id():
            return model, saved.get(model)
    raise ValueError('Модель в панели меняется прямо сейчас; повтори запрос.')


def personality_snapshot(panel=PANEL):
    """One atomic panel settings snapshot, shared by all Telegram roles."""
    saved = json.loads((panel/'data/settings.json').read_text())
    if not isinstance(saved, dict):
        raise ValueError('Invalid shared character settings')
    character = saved.get('character', '')
    custom = saved.get('customPrompt', '')
    if not isinstance(character, str) or not isinstance(custom, str):
        raise ValueError('Invalid shared character text')
    if len(character) > 8000 or len(custom) > 20000:
        raise ValueError('Shared character text exceeds its limit')
    return (character.strip() if saved.get('systemPrompt') is not False else '', custom.strip())


def replies_enabled(key, panel=PANEL):
    """Per-chat speaking permission; absent means the historical enabled state."""
    saved = json.loads((panel/'data/settings.json').read_text())
    if not isinstance(saved, dict):
        raise ValueError('Invalid shared chat settings')
    return saved.get(key) is not False


def lightcone_replies_enabled(panel=PANEL):
    return replies_enabled('lightconeReplies', panel)


def debri_replies_enabled(panel=PANEL):
    return replies_enabled('debriReplies', panel)


def memory_snapshot(panel=PANEL):
    """Each switch starts a new context epoch; retained logs are not erased."""
    saved = json.loads((panel/'data/settings.json').read_text())
    if not isinstance(saved, dict):
        raise ValueError('Invalid shared memory settings')
    return (saved.get('memory') is not False, str(saved.get('memoryEpoch', 'initial')),
            max(0, int(saved.get('memoryResetAt', 0))))


def memory_enabled(panel=PANEL):
    return memory_snapshot(panel)[0]


async def thinking_metadata(model, pi_bin, panel=PANEL):
    binary = Path(pi_bin).resolve()
    package = next((p for p in binary.parents if (p/'package.json').is_file()
                    and json.loads((p/'package.json').read_text()).get('name')
                    in ('@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent')), None)
    if package is None:
        raise ValueError('Не удалось определить установленный Pi.')
    request = {'sdkEntry': str(package/'dist/index.js'),
               'cwd': str(panel.parent/'projects'),
               'agentDir': str(PANEL_HOME/'.pi/agent'),
               'modelId': model, 'operation': 'thinking'}
    proc = await asyncio.create_subprocess_exec(
        '/usr/local/bin/node', str(panel/'server/pi-context-reader.mjs'),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL)
    try:
        async with asyncio.timeout(15):
            output, _ = await proc.communicate(json.dumps(request).encode())
        metadata = json.loads(output)
        if proc.returncode or not isinstance(metadata, dict) or not metadata.get('levels'):
            raise ValueError('Не удалось прочитать параметры модели из панели Никиты.')
        return metadata
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()


async def selected_settings(pi_bin, panel=PANEL, metadata_reader=thinking_metadata):
    model, saved = snapshot(panel)
    metadata = await metadata_reader(model, pi_bin, panel)
    level = saved if saved in metadata['levels'] else metadata['defaultLevel']
    return model, level
