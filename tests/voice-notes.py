"""Portable voice routing tests. Optional --sample is an operator-supplied synthetic Russian Ogg/Opus."""
import argparse,asyncio,sys,time,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'telegram'))
import instance
from voice_notes import audio_format,recognize,VoiceError

class VoiceRouting(unittest.IsolatedAsyncioTestCase):
    def event(self):return NS(is_private=True,out=False,sender_id=17,chat_id=17,raw_text='',message=NS(voice=True,reply_to_msg_id=None))
    async def test_scope(self):
        e=self.event();self.assertTrue(instance.owner_dm(e,17));self.assertFalse(instance.owner_dm(e,19))
        e.is_private=False;self.assertFalse(instance.owner_dm(e,17));e.is_private=True;e.message.voice=None
        self.assertFalse(instance.owner_dm(e,17))
    def test_audio_documents(self):
        for mime,name,fmt in [('audio/ogg',None,'ogg'),('application/octet-stream','Poem.Opus','ogg'),('audio/mpeg',None,'mp3'),('audio/x-wav','test','wav'),('video/mp4','fake.ogg',None),('application/octet-stream','x.py',None)]:
            self.assertEqual(audio_format(NS(file=NS(mime_type=mime,name=name))),fmt)
    async def test_voice_is_not_command_or_inspection(self):
        for phrase in ('ok','/image test','hello'):
            with patch.object(instance,'owner_profile',return_value={'toolsOn':False}),patch.object(instance,'recognize',new=AsyncMock(return_value=phrase)),patch.object(instance,'answer',new=AsyncMock(return_value='reply')) as turn:
                self.assertEqual(await instance.tool_turn(self.event()),('reply',None))
                prompt=turn.await_args.args[0];self.assertIn(phrase,prompt);self.assertNotEqual(prompt,phrase);self.assertFalse(turn.await_args.kwargs['inspect_owner'])
    async def test_mute_and_unintelligible(self):
        with patch.object(instance,'owner_profile',return_value={'replyMode':'off'}),patch.object(instance,'recognize',new=AsyncMock()) as read:
            self.assertEqual(await instance.tool_turn(self.event()),('',None));read.assert_not_awaited()
        with patch.object(instance,'owner_profile',return_value={}),patch.object(instance,'recognize',new=AsyncMock(side_effect=VoiceError('repeat'))),patch.object(instance,'answer',new=AsyncMock()) as turn:
            self.assertEqual(await instance.tool_turn(self.event()),('repeat',None));turn.assert_not_awaited()

async def sample(path,expected):
    async def download(m,file):
        with path.open('rb') as src:
            while block:=src.read(256*1024):file.write(block)
    t=time.monotonic();result=await recognize(NS(file=NS(size=path.stat().st_size,name=path.name,mime_type='application/octet-stream')),download)
    assert expected.casefold() in result.casefold(),'Expected fixture words missing';print(f'Local voice fixture recognized in {time.monotonic()-t:.2f} s')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sample',type=Path);parser.add_argument('--expect');args=parser.parse_args()
    if args.sample:
        if not args.expect:parser.error('--expect is required with --sample')
        asyncio.run(sample(args.sample,args.expect))
    unittest.main(argv=[sys.argv[0]])
