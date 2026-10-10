from .base import Game

ROWS, COLS = 6, 7


class Connect4(Game):
    key = "connect4"
    max_players = 12  # two seats, everyone else spectates

    def __init__(self, room):
        super().__init__(room)
        self.phase = "waiting"
        self.seats = [None, None]
        self.starter = 0
        self.score = {}
        self.reset_board()

    def reset_board(self):
        self.board = [[0] * COLS for _ in range(ROWS)]
        self.turn = self.starter
        self.winner = None
        self.win_cells = []
        self.last = None
        self.moves = 0

    def listed(self):
        return None in self.seats

    def new_game(self):
        self.reset_board()
        self.phase = "playing"
        self.tainted = False

    def save_results(self):
        a, b = self.seats
        if not a or not b:
            return
        if self.winner == -1:
            for uid in (a, b):
                self.record(uid, "draw", {"c4.draws": ("add", 1)}, f"Draw after {self.moves} moves")
            return
        win, lose = (a, b) if self.winner == 0 else (b, a)
        self.record(win, "win", {"c4.wins": ("add", 1)}, f"Won in {self.moves} moves")
        self.record(lose, "loss", {"c4.losses": ("add", 1)}, f"Lost in {self.moves} moves")

    def on_admin(self, m, action, msg):
        if action == "win" and m.uid in self.seats and self.phase == "playing":
            self.winner = self.seats.index(m.uid)
            self.win_cells = []
            self.phase = "over"
            self.score[m.uid] = self.score.get(m.uid, 0) + 1
            self.push()
            return "🏆 You win. Obviously."
        if action == "undo" and self.phase == "playing" and self.last:
            r, c = self.last
            self.board[r][c] = 0
            self.moves -= 1
            self.turn ^= 1
            self.last = None
            self.push()
            return "↩️ Took back the last move."
        if action == "reset" and None not in self.seats:
            self.new_game()
            self.tainted = True
            self.push()
            return "🔄 Fresh board."
        return None

    def state_for(self, m):
        return {"phase": self.phase, "seats": self.seats, "board": self.board, "turn": self.turn,
                "winner": self.winner, "winCells": self.win_cells, "last": self.last,
                "score": self.score}

    def push(self):
        self.broadcast("state", **self.state_for(None))

    def fill_seats(self):
        for i in (0, 1):
            if self.seats[i] is None:
                for uid, mm in self.room.members.items():
                    if mm.online and uid not in self.seats:
                        self.seats[i] = uid
                        break

    def on_join(self, m, rejoin):
        if m.uid not in self.seats and None in self.seats:
            self.fill_seats()
            if None not in self.seats:
                self.new_game()
        self.push()

    def on_leave(self, m):
        if m.uid in self.seats:
            self.seats[self.seats.index(m.uid)] = None
            self.fill_seats()
            if None in self.seats:
                self.phase = "waiting"
                self.reset_board()
            else:
                self.new_game()
        self.push()

    def on_message(self, m, t, msg):
        if t == "drop" and self.phase == "playing" and self.seats[self.turn] == m.uid:
            col = msg.get("col")
            if not isinstance(col, int) or not 0 <= col < COLS:
                return
            for r in range(ROWS - 1, -1, -1):
                if self.board[r][col] == 0:
                    self.board[r][col] = self.turn + 1
                    break
            else:
                return
            self.last = [r, col]
            self.moves += 1
            cells = self.check(r, col)
            if cells:
                self.winner = self.turn
                self.win_cells = cells
                self.phase = "over"
                self.score[m.uid] = self.score.get(m.uid, 0) + 1
                self.save_results()
            elif self.moves == ROWS * COLS:
                self.winner = -1
                self.phase = "over"
                self.save_results()
            else:
                self.turn ^= 1
            self.push()
        elif t == "rematch" and self.phase == "over" and m.uid in self.seats:
            self.starter ^= 1
            self.new_game()
            self.push()
        elif t == "swap" and self.phase != "playing" and self.is_host(m):
            # host rotates a spectator into play
            others = [u for u, mm in self.room.members.items() if mm.online and u not in self.seats]
            if others and None not in self.seats:
                loser = self.seats[1] if self.winner == 0 else self.seats[0]
                self.seats[self.seats.index(loser)] = others[0]
                self.new_game()
                self.push()

    def check(self, r, c):
        p = self.board[r][c]
        for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
            cells = [[r, c]]
            for sign in (1, -1):
                rr, cc = r + dr * sign, c + dc * sign
                while 0 <= rr < ROWS and 0 <= cc < COLS and self.board[rr][cc] == p:
                    cells.append([rr, cc])
                    rr += dr * sign
                    cc += dc * sign
            if len(cells) >= 4:
                return cells
        return None
