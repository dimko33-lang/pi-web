"""One-shot private voice delivery; optional Linux end-to-end PCM -> Ogg -> GigaAM fixture."""
import asyncio,sys,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'telegram'))
import instance, spoken_reply as tts
from voice_notes import recognize

class Spoken(unittest.IsolatedAsyncioTestCase):
    async def test_phrase(self):
        m=NS(fwd_from=None)
        for s in ('Поговори со мной','Никита, поговори со мной. Почему идёт дождь?','поговори со мной!'):
            self.assertTrue(tts.requested(m,s))
        for s in ('не поговори со мной','Она сказала: «поговори со мной».','поговори со мною','поговори со мнойкой','привет'):
            self.assertFalse(tts.requested(m,s))
        self.assertFalse(tts.requested(NS(fwd_from=True),'Поговори со мной'))
    async def test_spoken_then_reset(self):
        for voice,raw,expected in [(False,'Поговори со мной: зачем?',True),(True,'',True),(False,'а дальше?',False)]:
            m=NS(voice=voice,fwd_from=None,reply_to_msg_id=None,media=voice);out={}
            with patch.object(instance,'owner_profile',return_value={'toolsOn':False}),patch.object(instance,'recognize',new=AsyncMock(return_value='Никита, поговори со мной.')),patch.object(instance,'answer',new=AsyncMock(return_value='ответ')) as turn:
                self.assertEqual(await instance.tool_turn(NS(raw_text=raw,message=m),delivery=out),('ответ',None));self.assertEqual(bool(out.get('spoken')),expected);self.assertEqual(tts.HINT in turn.await_args.args[0],expected)
    async def test_fallback_and_uncertain_delivery(self):
        client=NS(send_file=AsyncMock(side_effect=ConnectionError()))
        self.assertIsNone(await tts.send_spoken(client,9,1,'x'*1500));client.send_file.assert_not_awaited()
        with patch.object(tts,'prepare',new=AsyncMock(return_value=(object(),object()))):
            with self.assertRaises(ConnectionError):await tts.send_spoken(client,9,1,'ok')
            client.send_file.assert_awaited_once()

async def loopback():
    calls=[]
    async def send(peer,stream,**opts):
        assert peer==7 and opts['reply_to']==42 and opts['voice_note'] and opts['mime_type']=='audio/ogg'
        attr,=opts['attributes'];assert attr.voice and attr.duration>0 and attr.waveform
        data=stream.read();assert b'OpusHead' in data[:128]
        async def download(m,file):file.write(data)
        heard=await recognize(NS(voice=True,file=NS(size=len(data))),download)
        assert 'привет' in heard.lower() and 'никита' in heard.lower(),heard
        calls.append(1);return NS(id=43)
    msg=await tts.send_spoken(NS(send_file=send),7,42,'Привет, Дим. Это Никита.');assert msg and msg.id==43 and calls==[1]
    print('Local Irina -> Ogg/Opus -> Telegram voice attributes and reply target -> local GigaAM. No Telegram send.')

if __name__=='__main__':
    if '--live' in sys.argv:sys.argv.remove('--live');asyncio.run(loopback())
    unittest.main()
