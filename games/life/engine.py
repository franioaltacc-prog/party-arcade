"""Family Life engine: data loading, safe expressions, siblings and families.

Everything the game says and does lives in ./data/*.json so new events and
actions can be added without touching Python (see README.md).
"""
import ast
import json
import random
import traceback
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
STATS = ("health", "happy", "smarts", "looks")
EXTRA = ("fame", "karma", "music", "sport")
ICON = {"health": "❤️", "happy": "😊", "smarts": "🧠", "looks": "✨", "fame": "⭐",
        "karma": "😇", "music": "🎸", "sport": "🏅", "money": "💰"}
LEVELS = ["", "Senior ", "Lead ", "Head ", "Chief "]
# let-values with these names are shown as plain numbers instead of money
PLAIN_LETS = {"years", "n", "count", "pct"}


def load_data():
    data = {}
    for name in ("names", "jobs", "events", "family_events", "actions", "sibling_actions", "group_actions"):
        with open(DATA_DIR / f"{name}.json", encoding="utf-8") as f:
            data[name] = json.load(f)
    data["jobs"] = {k: v for k, v in data["jobs"].items() if not k.startswith("_")}
    validate(data)
    return data


# --------------------------------------------------------------------------
# Safe expressions: "smarts > 50 and money >= 1000", "100 - looks", "rand(3, 8)"
# --------------------------------------------------------------------------
FUNCS = {
    "min": min, "max": max, "round": round, "abs": abs, "int": int,
    "rand": lambda a, b: random.randint(int(min(a, b)), int(max(a, b))),
    "chance": lambda p: random.random() < p,
    "true": True, "false": False, "yes": True, "no": False,
}
_ALLOWED = (ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare, ast.IfExp, ast.Call,
            ast.Name, ast.Load, ast.Constant, ast.And, ast.Or, ast.Not, ast.Add, ast.Sub, ast.Mult,
            ast.Div, ast.FloorDiv, ast.Mod, ast.USub, ast.UAdd, ast.Eq, ast.NotEq, ast.Lt, ast.LtE,
            ast.Gt, ast.GtE)
_cache = {}


class ExprError(ValueError):
    pass


def compile_expr(src):
    code = _cache.get(src)
    if code is None:
        try:
            tree = ast.parse(src.strip(), mode="eval")
        except SyntaxError as e:
            raise ExprError(f"Bad expression {src!r}: {e.msg}") from None
        for node in ast.walk(tree):
            if not isinstance(node, _ALLOWED):
                raise ExprError(f"Not allowed in expression {src!r}: {type(node).__name__}")
            if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id in FUNCS):
                raise ExprError(f"Unknown function in {src!r}")
        code = compile(tree, "<life>", "eval")
        _cache[src] = code
    return code


def evaluate(expr, env):
    """Numbers pass through, [a, b] is a random whole number between a and b,
    strings are expressions using the variables in env."""
    if expr is None or isinstance(expr, bool):
        return expr
    if isinstance(expr, (int, float)):
        return expr
    if isinstance(expr, list) and len(expr) == 2 and all(isinstance(x, (int, float)) for x in expr):
        return random.randint(int(min(expr)), int(max(expr)))
    if isinstance(expr, str):
        try:
            return eval(compile_expr(expr), {"__builtins__": {}}, {**FUNCS, **env})
        except ExprError:
            raise
        except Exception as e:
            raise ExprError(f"Could not evaluate {expr!r}: {e}") from None
    return expr


def check(cond, env):
    if cond in (None, "", True):
        return True
    try:
        return bool(evaluate(cond, env))
    except ExprError:
        traceback.print_exc()
        return False


def num(expr, env, default=0):
    try:
        v = evaluate(expr, env)
        return int(round(v)) if isinstance(v, (int, float)) else default
    except ExprError:
        traceback.print_exc()
        return default


class _Fmt(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def fmt(text, ctx):
    if isinstance(text, list):
        text = random.choice(text)
    text = str(text or "")
    return text.format_map(_Fmt(ctx)) if "{" in text else text


def money_str(n):
    return ("-" if n < 0 else "") + f"${abs(int(n)):,}"


def pick_weighted(options, env, key="w"):
    """Pick one dict from options using its weight (number or expression), skipping failed conds."""
    opts = [o for o in options if check(o.get("cond"), env)]
    if not opts:
        return None
    weights = []
    for o in opts:
        try:
            w = float(evaluate(o.get(key, 1), env))
        except (ExprError, TypeError, ValueError):
            traceback.print_exc()
            w = 1.0
        weights.append(max(0.0001, w))
    return random.choices(opts, weights=weights)[0]


def validate(data):
    """Compile every expression at startup so typos in data files are caught early."""
    problems = []

    def walk(obj, where):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("cond", "w", "who", "target_cond", "each_cond", "amount") and isinstance(v, str) and v != "choose":
                    try:
                        compile_expr(v)
                    except ExprError as e:
                        problems.append(f"{where}.{k}: {e}")
                elif k in ("fx", "each", "self", "target", "let") and isinstance(v, dict):
                    for fk, fv in v.items():
                        if isinstance(fv, str) and fk not in ("log", "uni", "next", "living", "ach", "partner", "count", "die"):
                            try:
                                compile_expr(fv)
                            except ExprError as e:
                                problems.append(f"{where}.{k}.{fk}: {e}")
                walk(v, f"{where}.{k}")
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f"{where}[{i}]")

    for name, d in data.items():
        walk(d, name)
    if problems:
        print("\n⚠️  Problems in Family Life data files:\n  " + "\n  ".join(problems) + "\n")


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class Sibling:
    def __init__(self, cid, owner, member, first, gender, age):
        self.cid = cid
        self.owner = owner
        self.player = member.name
        self.avatar = member.avatar
        self.color = member.color
        self.first = first
        self.gender = gender
        self.age = age
        self.alive = True
        self.cause = None
        self.health = random.randint(72, 100)
        self.happy = random.randint(60, 95)
        self.smarts = random.randint(15, 95)
        self.looks = random.randint(15, 95)
        self.fame = 0
        self.karma = 50
        self.music = random.randint(0, 15)
        self.sport = random.randint(0, 15)
        self.money = 0
        self.rel_mom = random.randint(60, 85)
        self.rel_dad = random.randint(60, 85)
        self.living = "home"
        self.degrees = []
        self.uni = None
        self.job = None
        self.retired = False
        self.pension = 0
        self.jail = 0
        self.jail_total = 0
        self.partner = None
        self.ever_married = False
        self.kids = []
        self.pets = []
        self.assets = []
        self.achievements = []
        self.peak_prestige = 0
        self.best_job = None
        self.happy_sum = 0
        self.years = 0
        self.counters = {"chaos": 0, "crimes": 0, "pranks": 0, "arguments": 0, "gifts": 0, "hangouts": 0}
        self.log = []
        self.energy = 3
        self.done = set()
        self.event = None
        self.seen = {}
        self.score = None
        self.last_delta = []

    @property
    def name(self):
        return self.first

    def worth(self):
        return self.money + sum(a["value"] for a in self.assets)

    def emoji(self):
        if not self.alive:
            return "🪦"
        m = self.gender == "m"
        if self.age < 3:
            return "👶"
        if self.age < 13:
            return "👦" if m else "👧"
        if self.age < 20:
            return "🧑"
        if self.age < 65:
            return "👨" if m else "👩"
        return "👴" if m else "👵"

    def status(self, majors):
        if not self.alive:
            return f"🪦 Died at {self.age}"
        if self.jail:
            return f"🔒 In jail ({self.jail} yr{'s' if self.jail != 1 else ''} left)"
        if self.uni:
            return f"🎓 {majors[self.uni['major']][0]} student"
        if self.job:
            return f"{self.job['emoji']} {self.job['title']}"
        if self.retired:
            return "🏖️ Retired"
        if self.age < 2:
            return "🍼 Baby"
        if self.age < 5:
            return "🧸 Toddler"
        if self.age < 18:
            return "🎒 In school"
        return "😴 Unemployed"

    def add(self, key, value):
        setattr(self, key, max(0, min(100, getattr(self, key) + int(value))))

    def snap(self):
        return {k: getattr(self, k) for k in STATS + EXTRA + ("money",)}

    def diff(self, before):
        out = []
        for k, old in before.items():
            d = getattr(self, k) - old
            if d and k != "karma":
                out.append({"k": k, "icon": ICON[k], "d": d})
        return out

    def add_log(self, text):
        self.log.append({"age": self.age, "text": text})
        del self.log[:-160]

    def achieve(self, title):
        if title and title not in self.achievements:
            self.achievements.append(title)
            return True
        return False

    def has_asset(self, kind):
        return any(a["kind"] == kind for a in self.assets)


class Family:
    def __init__(self, names, rng=random):
        self.last = rng.choice(names["last"])
        self.place = rng.choice(names["places"])
        mom_job, dad_job = rng.choice(names["parent_jobs"]), rng.choice(names["parent_jobs"])
        self.mom = {"first": rng.choice(names["first_f"]), "age": rng.randint(26, 34), "alive": True,
                    "health": rng.randint(75, 100), "job": mom_job[0], "salary": mom_job[1], "care": False, "role": "Mom"}
        self.dad = {"first": rng.choice(names["first_m"]), "age": 0, "alive": True,
                    "health": rng.randint(75, 100), "job": dad_job[0], "salary": dad_job[1], "care": False, "role": "Dad"}
        self.dad["age"] = self.mom["age"] + rng.randint(-2, 4)
        self.married = True
        self.money = rng.randint(8, 60) * 1000
        self.pets = []
        self.inheritance = 0
        self.inheritance_year = None
        self.seen = {}
        self.cooldowns = {}
        self.log = []

    def parents(self):
        return [p for p in (self.mom, self.dad) if p["alive"]]

    def public(self):
        def parent(p):
            return {k: p[k] for k in ("first", "age", "alive", "health", "job", "care", "role")}
        return {"last": self.last, "place": self.place, "mom": parent(self.mom), "dad": parent(self.dad),
                "married": self.married, "money": self.money, "pets": self.pets, "inheritance": self.inheritance}
