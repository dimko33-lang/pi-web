"""Persistent conversation and one-shot, owner-approved outbox. No network code."""
import json
import re
import secrets
import sqlite3
import time

OWNER_ID = @@OWNER_ID@@
# Keep one current message plus up to 500 earlier rows for the next model turn.
HISTORY_ROWS = 501


def command(text):
    text = re.sub(r"[\s,!.?]+", " ", text.lower()).strip()
    # Whole-message approval only. Conversational fillers are allowed, but quoted,
    # negated, conditional or amended requests must never accidentally send a draft.
    if text == "/send" or re.fullmatch(
        r"(?:ну )?(?:(?:да|давай) )?(?:отправляй|отправь)(?: в чат)?(?: пожалуйста)?", text
    ):
        return "send"
    if text in {"отмена", "отмени", "не отправляй", "/cancel"}:
        return "cancel"
    return None


def owner_private(event):
    return bool(event.is_private and event.sender_id == OWNER_ID
                and event.chat_id == OWNER_ID)


class State:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (
          id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, title TEXT NOT NULL,
          text TEXT NOT NULL, reply_to INTEGER, format TEXT NOT NULL,
          status TEXT NOT NULL, preview_id INTEGER, created REAL NOT NULL,
          random_id INTEGER NOT NULL, sent_id INTEGER);
        CREATE TABLE IF NOT EXISTS incoming (id INTEGER PRIMARY KEY);
        ''')
        self.db.commit()

    def seen(self, message_id):
        with self.db:
            cur = self.db.execute('INSERT OR IGNORE INTO incoming VALUES (?)', (message_id,))
        return cur.rowcount == 0

    def add(self, role, text):
        with self.db:
            # The article tool accepts 30000 characters; retain its complete successful output.
            limit = 30000 if role == 'assistant_article' else 24000
            row = self.db.execute('INSERT INTO history(role,text) VALUES (?,?)', (role, text[:limit]))
            self.db.execute('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)', (HISTORY_ROWS,))
        return row.lastrowid

    def history(self):
        rows = list(reversed(self.db.execute('SELECT role,text FROM history ORDER BY id DESC LIMIT 40').fetchall()))
        result, size = [], 0
        for row in reversed(rows):
            if size + len(row['text']) > 80000:
                break
            result.append(dict(row)); size += len(row['text'])
        return list(reversed(result))

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM kv WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO kv VALUES (?,?)', (key, json.dumps(value, ensure_ascii=False)))

    def draft(self, chat_id, title, text, reply_to=None, format='text'):
        if chat_id >= 0:
            raise ValueError('Черновики предназначены только для групп и каналов.')
        if not text.strip() or len(text) > 3900:
            raise ValueError('Черновик должен содержать от 1 до 3900 символов.')
        if format not in ('text', 'article'):
            raise ValueError('Неизвестный формат черновика.')
        with self.db:
            self.db.execute("UPDATE drafts SET status='superseded' WHERE status='pending'")
            cur = self.db.execute('''INSERT INTO drafts
              (chat_id,title,text,reply_to,format,status,created,random_id)
              VALUES (?,?,?,?,?,'pending',?,?)''',
              (chat_id,title,text,reply_to,format,time.time(),secrets.randbits(63)))
        return cur.lastrowid

    def preview(self, draft_id, message_id):
        with self.db:
            self.db.execute('UPDATE drafts SET preview_id=? WHERE id=?', (message_id,draft_id))

    def pending(self):
        row = self.db.execute("SELECT * FROM drafts WHERE status='pending' ORDER BY id DESC LIMIT 1").fetchone()
        return dict(row) if row else None

    def claim(self, reply_id=None):
        draft = self.pending()
        if not draft:
            raise ValueError('Нет черновика, ожидающего подтверждения.')
        if not draft['preview_id']:
            raise ValueError('Черновик ещё не показан. Попроси показать его заново.')
        if reply_id and reply_id != draft['preview_id']:
            raise ValueError('Это ответ не на текущий черновик. Подтверди последний черновик.')
        if time.time() - draft['created'] > 86400:
            raise ValueError('Черновик старше суток. Попроси обновить его перед отправкой.')
        with self.db:
            cur = self.db.execute("UPDATE drafts SET status='sending' WHERE id=? AND status='pending'", (draft['id'],))
        if cur.rowcount != 1:
            raise ValueError('Этот черновик уже обработан.')
        return draft

    def finish(self, draft_id, status, sent_id=None):
        with self.db:
            self.db.execute('UPDATE drafts SET status=?,sent_id=? WHERE id=?', (status,sent_id,draft_id))

    def cancel(self):
        with self.db:
            self.db.execute("UPDATE drafts SET status='cancelled' WHERE status='pending'")

    def interrupt(self):
        # A crash during delivery is ambiguous. Never automatically send it again.
        with self.db:
            self.db.execute("UPDATE drafts SET status='uncertain' WHERE status='sending'")
