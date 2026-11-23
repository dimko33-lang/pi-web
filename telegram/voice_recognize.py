"""Isolated local worker. Each process has a fresh recognizer for exactly one voice note."""
import ctypes as c
import json
from pathlib import Path
import sys


def main():
    assets=Path(sys.prefix)/'nikita-voice-ru-v1'
    lib=c.CDLL(str(assets/'libvosk.so'))
    def api(name,result,*args):
        f=getattr(lib,'vosk_'+name);f.restype=result;f.argtypes=list(args);return f
    ptr,text,num=c.c_void_p,c.c_char_p,c.c_int
    api('set_log_level',None,num)(-1)
    model=api('model_new',ptr,text)(bytes(assets/'vosk-model-small-ru-0.22'))
    if not model:raise RuntimeError('Model unavailable')
    rec=api('recognizer_new',ptr,ptr,c.c_float)(model,16000.)
    if not rec:raise RuntimeError('Recognizer unavailable')
    api('recognizer_set_words',None,ptr,num)(rec,1)
    accept=api('recognizer_accept_waveform',num,ptr,text,num)
    result=api('recognizer_result',text,ptr);finish=api('recognizer_final_result',text,ptr)
    lines=[];length=0
    def collect(raw):
        nonlocal length
        obj=json.loads(raw);words=obj.get('result',[]);s=obj.get('text','').strip()
        if s and words and sum(w.get('conf',0) for w in words)/len(words)>=0.55:
            length+=len(s)+1
            if length>120000:raise ValueError('Voice note exceeds text context budget')
            lines.append(s)
    while chunk:=sys.stdin.buffer.read(8000):
        n=accept(rec,chunk,len(chunk))
        if n<0:raise RuntimeError('Recognition failed')
        if n:collect(result(rec))
    collect(finish(rec));api('recognizer_free',None,ptr)(rec);api('model_free',None,ptr)(model)
    print(json.dumps({'text':' '.join(lines)},ensure_ascii=False))

if __name__=='__main__':main()
