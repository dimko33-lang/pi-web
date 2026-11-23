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
            self.assertEqual(tts.requested(m,s),'qwen')
        for s in ('не поговори со мной','Она сказала: «поговори со мной».','поговори со мною','поговори со мнойкой','привет'):
            self.assertFalse(tts.requested(m,s))
        self.assertFalse(tts.requested(NS(fwd_from=True),'Поговори со мной'))
    async def test_one_cloud_turn(self):
        phrase='Ответь облачным голосом. Как дела?';m=NS(fwd_from=None,voice=True)
        self.assertEqual(tts.requested_turn(m,'',[phrase]),'qwen')
        self.assertEqual(tts.requested_turn(m,'@nikita Ответь голосом Qwen!'),'qwen')
        self.assertEqual(tts.requested_turn(m,'Поговори со мной'),'qwen')
        self.assertFalse(tts.requested_turn(NS(voice=None),'',['Поговори со мной']))
        self.assertFalse(tts.requested_turn(m,'Она сказала: «Ответь голосом Qwen»'))
        m.voice=None;self.assertFalse(tts.requested_turn(m,'',[phrase]))
        m.fwd_from=True;self.assertFalse(tts.requested_turn(m,phrase))
        client=NS(send_file=AsyncMock());self.assertIsNone(await tts.send_spoken(client,9,1,'x'*601,mode='qwen'));client.send_file.assert_not_awaited()
    def test_cloud_protocol(self):
        from io import BytesIO
        import json,qwen_tts as q
        url=q.HOST+'/gradio_api/file=/tmp/gradio/'+'b'*64+'/audio.wav';wav=b'RIFF1234WAVEdata'
        def check(link):
            calls=[]
            def req(target,**kw):
                calls.append(target)
                if len(calls)==1:
                    self.assertEqual(json.loads(target.data)['data'],['sample','Russian',q.STYLE]);return BytesIO(b'{"event_id":"' + b'a'*32 + b'"}')
                if len(calls)==2:return BytesIO(b'event: complete\ndata: '+json.dumps([{'url':link}]).encode()+b'\n')
                self.assertEqual(target,url);return BytesIO(wav)
            return q.synthesize('sample',req)
        self.assertEqual(check(url),wav)
        with self.assertRaises(ValueError):check('https://example.invalid/audio.wav')
    def test_owner_persistent_mode(self):
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory() as d,patch.object(tts,'GOOGLE_ENABLED',NS(is_file=lambda:True)):
            base=Path(d);m=NS();e=NS(is_private=True,sender_id=4,chat_id=4,raw_text='/voice_all on',message=m)
            self.assertIsNone(tts.owner_voice_command(base,e,9));self.assertFalse(tts.voice_policy(base,m,'Привет'))
            self.assertTrue(tts.owner_voice_command(base,e,4));self.assertEqual(tts.voice_policy(base,m,'Привет'),'gacrux');self.assertFalse(tts.voice_policy(base,m,'Ответь текстом, пожалуйста'))
            e.raw_text='/voice_all off';m.fwd_from=True;tts.owner_voice_command(base,e,4);self.assertEqual(tts.voice_policy(base,m,'Привет'),'gacrux');m.fwd_from=None
            tts.owner_voice_command(base,e,4);self.assertFalse(tts.voice_policy(base,m,'Привет'));self.assertEqual(tts.voice_policy(base,m,'Поговори со мной'),'gacrux')
    def test_optional_google_voice(self):
        from io import BytesIO
        import base64,json,wave,gacrux_worker as google
        with patch.object(tts,'GOOGLE_ENABLED',NS(is_file=lambda:True)):
            self.assertEqual(tts.requested(NS(),'Поговори со мной'),'gacrux');self.assertEqual(tts.requested(NS(),'Ответь облачным голосом'),'gacrux')
            self.assertEqual(tts.requested(NS(),'Ответь голосом Qwen'),'qwen');self.assertFalse(tts.requested(NS(),'Что дальше?'))
        def post(req,**kw):
            self.assertEqual(req.full_url,google.URL);self.assertNotIn('example-key',req.full_url);self.assertEqual(req.get_header('X-goog-api-key'),'example-key')
            payload=json.loads(req.data);self.assertEqual(payload['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName'],'Gacrux')
            data={'mimeType':'audio/l16; rate=24000; channels=1','data':base64.b64encode(b'\0\1'*100).decode()};return BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'inlineData':data}]}}]}).encode())
        with wave.open(BytesIO(google.render('test','example-key',post))) as audio:self.assertEqual((audio.getframerate(),audio.getnframes()),(24000,100))
        self.assertIn('Gacrux',tts.cloud_failure('gacrux'))
    async def test_spoken_then_reset(self):
        for voice,raw,expected in [(False,'Поговори со мной: зачем?',True),(True,'',True),(False,'а дальше?',False)]:
            m=NS(voice=voice,fwd_from=None,reply_to_msg_id=None,media=voice);out={}
            with patch.object(instance,'owner_profile',return_value={'toolsOn':False}),patch.object(instance,'recognize',new=AsyncMock(return_value='Никита, поговори со мной.')),patch.object(instance,'answer',new=AsyncMock(return_value='ответ')) as turn:
                self.assertEqual(await instance.tool_turn(NS(raw_text=raw,message=m),delivery=out),('ответ',None));self.assertEqual(out.get('spoken'),'qwen' if expected else None);self.assertEqual(tts.HINT in turn.await_args.args[0],expected)
    async def test_fallback_and_uncertain_delivery(self):
        client=NS(send_file=AsyncMock(side_effect=ConnectionError()))
        self.assertIsNone(await tts.send_spoken(client,9,1,'x'*1500));client.send_file.assert_not_awaited()
        with patch.object(tts,'prepare',new=AsyncMock(return_value=(object(),object()))):
            with self.assertRaises(ConnectionError):await tts.send_spoken(client,9,1,'ok')
            client.send_file.assert_awaited_once()

async def loopback(mode=True):
    calls=[]
    async def send(peer,stream,**opts):
        assert peer==7 and opts['reply_to']==42 and opts['voice_note'] and opts['mime_type']=='audio/ogg'
        attr,=opts['attributes'];assert attr.voice and attr.duration>0 and attr.waveform
        data=stream.read();assert b'OpusHead' in data[:128]
        async def download(m,file):file.write(data)
        heard=await recognize(NS(voice=True,file=NS(size=len(data))),download)
        assert 'привет' in heard.lower() and 'никита' in heard.lower(),heard
        calls.append(1);return NS(id=43)
    msg=await tts.send_spoken(NS(send_file=send),7,42,'Привет, Дим. Это Никита.',mode=mode);assert msg and msg.id==43 and calls==[1]
    print(('Public Qwen demo' if mode=='qwen' else 'Local Irina')+' -> Ogg/Opus -> Telegram voice attributes and reply target -> local GigaAM. No Telegram send.')

if __name__=='__main__':
    if '--live' in sys.argv:sys.argv.remove('--live');asyncio.run(loopback())
    if '--cloud-live' in sys.argv:sys.argv.remove('--cloud-live');asyncio.run(loopback('qwen'))
    unittest.main()
