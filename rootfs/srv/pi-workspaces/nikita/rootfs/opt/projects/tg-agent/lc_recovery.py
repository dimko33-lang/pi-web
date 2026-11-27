"""LightCone only. No message bodies, background reads for the model, or extra service."""
import time

WINDOW = 3600
BACKOFF = 30

class ReplyQueue:
    def __init__(self, state, latest):
        self.state, self.db = state, state.db
        with self.db:
            self.db.execute('CREATE TABLE IF NOT EXISTS lc_pending(id INTEGER PRIMARY KEY, sender INTEGER NOT NULL, expires REAL NOT NULL, due REAL NOT NULL, history_id INTEGER)')
        # First installation starts at the tip, not one hour into old conversations.
        self.cursor = state.get('lc_poll_cursor_v1')
        if self.cursor is None:
            self.advance(latest)
        self.boot_tip = latest
        self.activation_tip = state.get('lc_poll_activation_v1')
        if self.activation_tip is None:
            self.activation_tip = self.cursor
            state.set('lc_poll_activation_v1', self.cursor)

    def advance(self, mid):
        if self.cursor is None or mid > self.cursor:
            self.state.set('lc_poll_cursor_v1', mid)
            self.cursor = mid

    def begin(self, mid, sender, expires):
        with self.db:
            if not self.db.execute('INSERT OR IGNORE INTO incoming VALUES (?)',(mid,)).rowcount:
                return False
            self.db.execute('INSERT INTO lc_pending VALUES(?,?,?,?,NULL)',(mid,sender,expires,time.time()+BACKOFF))
        return True

    def forget(self, mid):
        with self.db:
            self.db.execute('DELETE FROM lc_pending WHERE id=?',(mid,))

    def due(self):
        now=time.time()
        with self.db:
            self.db.execute('DELETE FROM lc_pending WHERE expires<=?',(now,))
        return self.db.execute('SELECT id,sender FROM lc_pending WHERE due<=? ORDER BY id LIMIT 1',(now,)).fetchone()

    def take_retry(self, mid, sender):
        # Consume BEFORE second model call: never a third attempt, even on another crash.
        now=time.time()
        with self.db:
            row=self.db.execute('SELECT history_id FROM lc_pending WHERE id=? AND sender=? AND due<=? AND expires>?',(mid,sender,now,now)).fetchone()
            if row is not None:
                self.db.execute('DELETE FROM lc_pending WHERE id=?',(mid,))
        return row

    def remember_row(self, mid, history_id):
        with self.db:
            self.db.execute('UPDATE lc_pending SET history_id=? WHERE id=?',(history_id,mid))

    async def unanswered(self, client, chat, mid):
        # Manual/account replies count too. If the inspection is incomplete, abstain.
        later=await client.get_messages(chat,min_id=mid,limit=201)
        return len(later)<=200 and not any(m.out and m.reply_to_msg_id==mid for m in later)
