"""Synthetic socket/paid-provider checks. No external traffic or credentials."""
import io, json, struct, sys, tempfile, unittest, wave
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'telegram'))
import heygen_render as h

class Renderer(unittest.TestCase):
    def test_paid_submit_never_repeats(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'portrait.jpg').write_bytes(b'\xff\xd8test');(root/'heygen-key').write_text('test')
            with wave.open(str(root/'speech.wav'),'wb') as f:
                f.setparams((1,2,24000,0,'NONE',''));f.writeframes(b'\0'*96000)
            wav=(root/'speech.wav').read_bytes();payload=struct.pack('!qQ',-100123,12)+wav; calls=[]
            def api(path,key,payload=None):
                calls.append(path)
                if path=='users/me':return {'wallet':{'currency':'usd','remaining_balance':2}}
                self.assertEqual(payload['model'],'heygen-avatar-6');raise TimeoutError('ambiguous submit')
            with patch.object(h,'api',api):
                with self.assertRaises(TimeoutError):h.work(io.BytesIO(payload),io.BytesIO(),root,root)
                with self.assertRaises(FileExistsError):h.work(io.BytesIO(payload),io.BytesIO(),root,root)
            self.assertEqual(calls,['users/me','models/avatars'])
            with patch.object(h,'api',return_value={'wallet':{'currency':'usd','remaining_balance':0}}) as api:
                with self.assertRaises(RuntimeError):h.submit(root,'test')
                self.assertEqual(api.call_count,1)

if __name__=='__main__':unittest.main()
