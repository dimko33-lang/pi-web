"""Resolve a verified outgoing Telegram video note, never an arbitrary history row."""
import json
from pathlib import Path

_store = None

def configure(reader):
    global _store
    _store = reader

def file_reader(base):
    def read(peer, mid, source):
        try:
            item = json.loads((Path(base)/'circle-transcripts'/str(peer)/f'{mid}.json').read_text())
        except FileNotFoundError:
            return ''
        # Version 0 stored only the text; the enclosing peer/message key was verified at send.
        if isinstance(item, str): return item
        return item.get('text', '') if isinstance(item, dict) and item.get('source') == source else ''
    return read

def sql_reader(users):
    """Reference transport: read its existing per-peer receipts without creating a DB."""
    import sqlite3
    from contextlib import closing
    def read(peer, mid, source):
        path = Path(users)/str(abs(peer))/'conversation.sqlite3'
        if not path.is_file(): return ''
        with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=1)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='circle_transcripts'").fetchone(): return ''
            row=db.execute('SELECT transcript FROM circle_transcripts WHERE peer=? AND sent=? AND source=?',(peer,mid,source)).fetchone()
            return row[0] if row else ''
    return read

def lookup(m, reader=None):
    reader = reader or _store
    if not reader or not getattr(m,'out',False) or not getattr(m,'video_note',None) or getattr(m,'fwd_from',None): return ''
    peer, mid, source = (getattr(m, k, None) for k in ('chat_id','id','reply_to_msg_id'))
    if type(peer) is not int or not peer or type(mid) is not int or type(source) is not int or not 0 < source < mid: return ''
    text = reader(peer, mid, source)
    return text[:1500] if isinstance(text,str) else ''
