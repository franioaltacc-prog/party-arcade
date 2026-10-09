from .blitz import Blitz
from .casino import Casino
from .connect4 import Connect4
from .dash import Dash
from .doodle import Doodle
from .life import Life

GAMES = {g.key: g for g in (Dash, Life, Doodle, Blitz, Connect4, Casino)}
