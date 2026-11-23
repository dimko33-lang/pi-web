"""Exercise the reference queue across a real SQLite close/reopen, without a login."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
from lc_recovery import ReplyQueue


class State:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript('CREATE TABLE IF NOT EXISTS incoming(id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v INTEGER)')

    def get(self, key):
        row = self.db.execute('SELECT v FROM kv WHERE k=?', (key,)).fetchone()
        return row and row[0]

    def set(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO kv VALUES(?,?)', (key, value))


class Recovery(unittest.TestCase):
    def test_restart(self):
        with tempfile.TemporaryDirectory() as directory, patch('lc_recovery.time.time') as now:
            path = Path(directory, 'synthetic.db')
            now.return_value = 100
            state = State(path)
            queue = ReplyQueue(state, latest=40)
            self.assertEqual(queue.cursor, 40)
            self.assertTrue(queue.begin(41, 9, expires=3700))
            self.assertFalse(queue.begin(41, 9, expires=3700))
            queue.remember_row(41, 123)
            self.assertIsNone(queue.due())
            queue.advance(41)
            state.db.close()
            state = State(path)
            queue = ReplyQueue(state, latest=44)
            self.assertEqual(queue.cursor, 41)
            now.return_value = 131
            self.assertEqual(queue.due(), (41, 9))
            self.assertEqual(queue.take_retry(41, 9), (123,))
            self.assertIsNone(queue.take_retry(41, 9))
            state.db.close()


if __name__ == '__main__':
    unittest.main()
