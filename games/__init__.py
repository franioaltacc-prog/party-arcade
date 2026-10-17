from .billiards import Billiards
from .blitz import Blitz
from .casino import Casino
from .connect4 import Connect4
from .dash import Dash
from .doodle import Doodle
from .flappy import Flappy
from .front import Front
from .golf import Golf
from .impostor import Impostor
from .life import Life
from .mines import Minesweeper
from .poly import Poly
from .prophunt import PropHunt
from .songs import SongRush

GAMES = {g.key: g for g in (Dash, Life, Doodle, SongRush, Blitz, Connect4, Casino, Impostor, Minesweeper, Front, PropHunt, Poly, Flappy, Golf, Billiards)}
