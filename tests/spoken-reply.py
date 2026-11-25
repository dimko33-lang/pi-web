"""One-shot private voice delivery; optional Linux end-to-end PCM -> Ogg -> GigaAM fixture."""
import asyncio,sys,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'telegram'))
import instance, spoken_reply as tts
from voice_notes import recognize

class Spoken(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Test the fresh default even if this Python's deployment enrolled a real speech service.
        disabled = patch.object(tts, 'GOOGLE_ENABLED', NS(is_file=lambda: False))
        disabled.start(); self.addCleanup(disabled.stop)

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
    def test_profile_format(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            base=Path(d);(base/'voice-all-gacrux.enabled').mkdir()
            for text,voice,expected in [(False,False,(True,True)),(True,False,(False,False)),(False,True,(True,True)),(True,True,(False,True))]:
                prefs=dict(textOutput=text,voiceOutput=voice)
                for incoming,want in zip([False,True],expected):
                    mode=tts.voice_policy(base,NS(voice=incoming),'Поговори со мной' if text else 'Привет',profile=prefs)
                    self.assertEqual(mode,'gacrux' if want else False)
            prefs=dict(textOutput=True,voiceOutput=True)
            for msg in (NS(voice=True,fwd_from=True),NS(audio=True),NS(reply_to_msg_id=41)):
                self.assertFalse(tts.voice_policy(base,msg,'Привет',['поговори со мной'],profile=prefs))
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
            # Approved audition C: freeze the full wire settings for the fixed utterance 'test'.
            import hashlib
            fixture=json.dumps([req.full_url,payload],sort_keys=True,separators=(',',':')).encode()
            self.assertEqual(hashlib.sha256(fixture).hexdigest(),'9237a7fb29d1630ec9348bfe3e0b2e7e79f35496b1fcf46840238afc2d29a2c2')
            data={'mimeType':'audio/l16; rate=24000; channels=1','data':base64.b64encode(b'\0\1'*100).decode()};return BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'inlineData':data}]}}]}).encode())
        with wave.open(BytesIO(google.render('test','example-key',post))) as audio:self.assertEqual((audio.getframerate(),audio.getnframes()),(24000,100))
    async def test_private_elder_preset(self):
        import tempfile,json,os
        from telethon import types
        from datetime import datetime,timezone
        p=dict(voicePreset='charon-elder',textOutput=True,voiceOutput=True,toolsOn=False,memory=False)
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,PI_WEB_TELEGRAM_DATA=d):
            base=Path(d);(base/'conversation-profiles.json').write_text(json.dumps({'version':1,'profiles':{'dm_17':p,'guest_dm':p}}))
            def event(peer,voice):
                m=NS(voice=voice,is_private=True,reply_to_msg_id=None,fwd_from=None,media=voice)
                return NS(id=1,is_private=True,chat_id=peer,sender_id=peer,out=False,raw_text='' if voice else 'hello',message=m)
            with patch.object(instance,'recognize',AsyncMock(return_value='fixture')),patch.object(instance,'answer',AsyncMock(return_value='reply')):
                for peer,voice,want in [(17,True,'charon-elder'),(17,False,None),(18,True,'gacrux')]:
                    delivery={};self.assertEqual(await instance.tool_turn(event(peer,voice),guest=peer,delivery=delivery),('reply',None));self.assertEqual(delivery.get('spoken'),want)
            for target,want in [(types.PeerUser(17),'charon-elder'),(types.PeerChannel(42),'gacrux')]:
                msg=types.Message(id=1,peer_id=target,date=datetime.now(timezone.utc),message='hello')
                self.assertEqual(tts.voice_policy(base,msg,'hello',profile={**p,'textOutput':False}),want)
            self.assertFalse(tts.voice_policy(base,event(17,True).message,'hello',profile={**p,'voiceOutput':False}))
            with patch.object(tts,'prepare',AsyncMock()) as synth:
                self.assertIsNone(await tts.send_spoken(None,-17,1,'test',mode='charon-elder'));synth.assert_not_awaited()
            with patch.object(tts,'google_wave',AsyncMock(side_effect=OSError)) as broker,patch.object(tts,'run',AsyncMock()) as fallback:
                self.assertIsNone(await tts.prepare('test',cloud='charon-elder'));self.assertEqual(broker.await_args.kwargs,{'preset':'charon-elder'})
                self.assertIsNone(await tts.prepare('x'*1501,cloud='charon-elder'));broker.assert_awaited_once();fallback.assert_not_awaited()

    def test_elder_broker_request(self):
        import base64,json,wave,gacrux_worker as g
        from io import BytesIO
        text='Тихий голос.'; seen=[]
        def post(req,**kw):
            self.assertEqual(req.full_url,g.URL);seen.append(json.loads(req.data));audio={'mimeType':'audio/l16; rate=24000','data':base64.b64encode(b'\0\0'*100).decode()}
            return BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'inlineData':audio}]}}]}).encode())
        for preset,name in [('charon-elder','Charon'),('gacrux','Gacrux')]:
            body=tts.google_packet(text,preset);self.assertEqual(g.decode_request(body),(text,preset))
            with wave.open(BytesIO(g.render(text,'fixture',post,preset=preset))) as wav:self.assertEqual(wav.getnframes(),100)
            data=seen[-1];self.assertEqual(data['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName'],name)
            words=data['contents'][0]['parts'][0]['text'];self.assertTrue(words.endswith(text));self.assertIn('no audible smile',words)
            if preset=='charon-elder':self.assertIn('everyday conversation',words)
        self.assertEqual(g.decode_request(b'{"voicePreset":"charon-elder"}')[1],'gacrux')
        with self.assertRaises(ValueError):g.decode_request(b'\xffunknown\0test')
        with self.assertRaises(ValueError):g.decode_request(tts.google_packet('x'*(g.MAX_INPUT_BYTES+1),'charon-elder'))
        with self.assertRaises(ValueError):g.render('test','fixture',post,preset='unknown')
        self.assertEqual(len(seen),2)

    async def test_spoken_then_reset(self):
        for voice,raw,expected in [(False,'Поговори со мной: зачем?',True),(True,'',True),(False,'а дальше?',False)]:
            m=NS(voice=voice,fwd_from=None,reply_to_msg_id=None,media=voice);out={}
            with patch.object(instance,'owner_profile',return_value={'toolsOn':False}),patch.object(instance,'recognize',new=AsyncMock(return_value='Никита, поговори со мной.')),patch.object(instance,'answer',new=AsyncMock(return_value='ответ')) as turn:
                self.assertEqual(await instance.tool_turn(NS(raw_text=raw,message=m),delivery=out),('ответ',None));self.assertEqual(out.get('spoken'),'qwen' if expected else None);self.assertEqual(tts.HINT in turn.await_args.args[0],expected)
    async def test_gacrux_character_limit(self):
        import gacrux_worker as google
        from unittest.mock import Mock
        text='🐈'*1500
        self.assertEqual(len(text.encode()),google.MAX_INPUT_BYTES)
        # No external synthesis: inspect which full texts reach each boundary.
        with patch.object(tts,'google_wave',new=AsyncMock(side_effect=EOFError)) as broker:
            await tts.prepare(text,cloud='gacrux');broker.assert_awaited_once();self.assertEqual(broker.await_args.args[0],text)
            await tts.prepare(text+'я',cloud='gacrux');broker.assert_awaited_once()
        http=Mock(side_effect=EOFError)
        with self.assertRaises(EOFError):google.render(text,'dummy',http)
        with self.assertRaises(ValueError):google.render(text+'я','dummy',http)
        http.assert_called_once()
    async def test_plain_text_when_voice_not_sent(self):
        for peer,mode,text in [(17,'gacrux','я'*1501),(-17,'qwen','Ответ без предисловия.')]:
            event=NS(id=8,chat_id=peer,reply=AsyncMock(return_value=NS(id=9)))
            with patch.object(instance,'send_spoken',new=AsyncMock(return_value=None)),patch.object(instance,'verify_blocks',new=AsyncMock()):
                await instance.deliver_answer(None,NS(notify=lambda *args:None),event,text,mode)
            event.reply.assert_awaited_once();self.assertEqual(event.reply.await_args.args,(text,))
    async def test_fallback_and_uncertain_delivery(self):
        client=NS(send_file=AsyncMock(side_effect=ConnectionError()))
        self.assertIsNone(await tts.send_spoken(client,9,1,'x'*1500));client.send_file.assert_not_awaited()
        with patch.object(tts,'prepare',new=AsyncMock(return_value=(object(),object()))):
            with self.assertRaises(ConnectionError):await tts.send_spoken(client,9,1,'ok')
            client.send_file.assert_awaited_once()
            client.send_file=AsyncMock(side_effect=tts.ChatSendVoicesForbiddenError(request=None))
            self.assertIsNone(await tts.send_spoken(client,9,1,'ok',mode='gacrux'));client.send_file.assert_awaited_once()

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
