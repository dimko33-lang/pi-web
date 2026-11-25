"""Offline tests: real Telethon entity/MTProto builders, no session, credentials or sends."""
import tempfile
import sys
from pathlib import Path
from types import SimpleNamespace as Obj
from unittest import IsolatedAsyncioTestCase, main
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
from telethon import errors, functions, types
from salon_archive import bind, showcase_enabled
from showcase_reply import deliver_showcase

PEER, SOURCE = -1001234567890, 3


class Client:
    def __init__(self, *, limit=4096, errors_by_kind=None):
        self.log, self.limit, self.post, self.configs = [], limit, None, 0
        self.errors = errors_by_kind or {}

    def attempt(self, kind, peer, source, body, entities=()):
        assert (peer, source) == (PEER, SOURCE)
        self.log.append((kind, body, entities))
        if kind in self.errors:
            raise self.errors[kind]
        self.post = Obj(id=42, entities=entities, rich_message={} if kind=='article' else None, reply_to_msg_id=source)
        return self.post

    async def send_message(self, peer, body, *, reply_to, formatting_entities=(), **kwargs):
        return self.attempt('text', peer, reply_to, body, formatting_entities)

    async def send_file(self, peer, file, *, reply_to, force_document):
        assert force_document and file.name.endswith('.md')
        return self.attempt('file', peer, reply_to, file.read().decode('utf-8'))

    async def get_input_entity(self, peer):
        assert peer == PEER
        return types.InputPeerChannel(1234567890, 0)

    async def __call__(self, request):
        if isinstance(request, functions.help.GetConfigRequest):
            self.configs += 1
            return Obj(message_length_max=self.limit)
        assert isinstance(request, functions.messages.SendMessageRequest) and request.message == ''
        assert isinstance(request.rich_message, types.InputRichMessageMarkdown)
        assert isinstance(request.reply_to, types.InputReplyToMessage)
        post = self.attempt('article', PEER, request.reply_to.reply_to_msg_id, request.rich_message.markdown)
        msg = Obj(id=post.id, out=True)
        return Obj(updates=[] if 'no_receipt' in self.errors else [Obj(message=msg)])

    async def get_messages(self, peer, *, ids):
        assert peer == PEER and ids == self.post.id
        return self.post


class Showcase(IsolatedAsyncioTestCase):
    async def test_open_text_and_real_text_budget(self):
        c = Client()
        for text in ('a'*1801, 'x'*3901, '🌙'*4096, '**'+'я'*4096+'**'):
            notes = AsyncMock(side_effect=AssertionError)
            self.assertEqual(await deliver_showcase(c, PEER, SOURCE, text, notes=notes),42)
            kind, body, entities = c.log[-1]
            self.assertEqual(kind,'text'); self.assertEqual(body,text.strip('*'))
            self.assertFalse(any(getattr(e,'collapsed',False) for e in entities))
            notes.assert_not_called()
        self.assertEqual(c.configs,1)
        small=Client(limit=20)
        await deliver_showcase(small,PEER,SOURCE,'a'*21)
        self.assertEqual(small.log[0][:2],('article','a'*21))

    async def test_one_native_article_full_source_and_tex(self):
        for text in ('я'*4097,'a'*6000,'б'*29000,'x'*45000,'$x^2$','$$A=B$$',r'Formula: \(x^2\)',r'Formula: \[a=b\]'):
            c=Client(); notes=AsyncMock()
            await deliver_showcase(c,PEER,SOURCE,text,notes=notes)
            self.assertEqual([r[0] for r in c.log],['article']); notes.assert_not_awaited()
            md=c.log[0][1]
            if r'\(' in text:self.assertIn('$x^2$',md)
            elif r'\[' in text:self.assertIn('$$\na=b\n$$',md)
            else:self.assertEqual(md,text)
        c=Client();await deliver_showcase(c,PEER,SOURCE,'`$not_math$`');self.assertEqual(c.log[0][0],'text')
        c=Client();await deliver_showcase(c,PEER,SOURCE,'A short article',force_article=True);self.assertEqual(c.log[0][0],'article')

    async def test_only_definite_format_or_size_refusal_falls_back(self):
        c=Client(errors_by_kind={'text':errors.MessageTooLongError(None)})
        await deliver_showcase(c,PEER,SOURCE,'text');self.assertEqual([r[0] for r in c.log],['text','article'])
        notes=AsyncMock(return_value='Excerpt and verified article URL')
        c=Client(errors_by_kind={'article':errors.MessageTooLongError(None)})
        t='math $x$';await deliver_showcase(c,PEER,SOURCE,t,notes=notes)
        notes.assert_awaited_once_with(PEER,SOURCE,t);self.assertEqual([r[0] for r in c.log],['article','text'])
        for publisher in (None,AsyncMock(side_effect=OSError('no verified note'))):
            c=Client(errors_by_kind={'article':errors.BadRequestError(None,'RICH_MESSAGE_INVALID')})
            await deliver_showcase(c,PEER,SOURCE,t,notes=publisher)
            self.assertEqual([r[:2] for r in c.log],[('article',t),('file',t)])

    async def test_no_resend_after_uncertainty_or_unrelated_denial(self):
        for failure in (TimeoutError(), errors.ChatWriteForbiddenError(None), errors.BadRequestError(None,'PEER_ID_INVALID'), 'no_receipt'):
            problems=({'no_receipt':True} if failure=='no_receipt' else {'article':failure})
            c=Client(errors_by_kind=problems); notes=AsyncMock()
            with self.assertRaises(Exception):await deliver_showcase(c,PEER,SOURCE,'$x$',notes=notes)
            self.assertEqual([r[0] for r in c.log],['article']);notes.assert_not_called()
        for text in ('plain','```plotly\n{}\n```'):
            c=Client(errors_by_kind={'text':TimeoutError()});notes=AsyncMock(return_value='verified note')
            with self.assertRaises(TimeoutError):await deliver_showcase(c,PEER,SOURCE,text,notes=notes)
            self.assertEqual([r[0] for r in c.log],['text'])
            self.assertEqual(notes.await_count,int('plotly' in text))

    async def test_visual_note_or_native_if_unavailable(self):
        t='Diagram\n```diagram\n{}\n```'; c=Client();notes=AsyncMock(return_value='verified note')
        await deliver_showcase(c,PEER,SOURCE,t,notes=notes);self.assertEqual(c.log[0][:2],('text','verified note'))
        c=Client();notes=AsyncMock(side_effect=OSError())
        await deliver_showcase(c,PEER,SOURCE,t,notes=notes);self.assertEqual(c.log[0][:2],('article',t));notes.assert_awaited_once()

    async def test_portable_adapter_and_same_group_native_history(self):
        import instance
        from datetime import datetime, timezone
        from salon_archive import SalonArchive, read
        from group_replies import Group
        from unittest.mock import Mock
        archive=Mock(); client=Client(); message=Obj(chat_id=PEER,id=SOURCE,reply=AsyncMock(return_value=Obj(id=15)))
        await instance.deliver_answer(client,archive,message,'$x$',showcase=True)
        self.assertEqual(client.log[0][0],'article');archive.notify.assert_called_with(PEER,42)
        await instance.deliver_answer(client,archive,message,'normal')
        message.reply.assert_awaited_once();archive.notify.assert_called_with(PEER,15)
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);bind(base,'lake',PEER,replies=True,showcase=True)
            m=Obj(id=42,chat_id=PEER,out=True,photo=None,date=datetime.now(timezone.utc),message='',raw_text='',
                  rich_message={'blocks':[{'_':'PageBlockParagraph','text':{'_':'TextMath','source':'x'}}]})
            group=Group(None,None,PEER,'lake',Obj(base=base),None,None,None)
            self.assertIn('$x$',group.text(m))
            reader=SalonArchive(base,17); reader.first_event[PEER]=m.id
            await reader.page(Obj(get_messages=AsyncMock(return_value=[m])),'lake',PEER)
            self.assertIn('$x$',read(base/'archive/lake/messages.json',[])[0]['text'])
            bind(base,'lake',PEER,showcase=False); self.assertEqual(group.text(m),'')

    async def test_scope_and_explicit_binding_are_separate_from_speaking(self):
        for peer,source in ((17,3),(0,3),(PEER,0),(PEER,True)):
            c=Client()
            with self.assertRaises(ValueError):await deliver_showcase(c,peer,source,'text')
            self.assertFalse(c.log)
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp); bind(d,'lake',PEER,showcase=True);self.assertFalse(showcase_enabled(d,PEER))
            bind(d,'lake',PEER,replies=True);self.assertTrue(showcase_enabled(d,PEER))
            bind(d,'arri',-555,replies=True);self.assertFalse(showcase_enabled(d,-555));self.assertFalse(showcase_enabled(d,17))
            bind(d,'lake',PEER,replies=False);self.assertFalse(showcase_enabled(d,PEER))
            bind(d,'lake',PEER,replies=True,showcase=False);self.assertFalse(showcase_enabled(d,PEER))


if __name__=='__main__': main()
