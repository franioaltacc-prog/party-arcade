"""Family Life content checks (games/life/data): every action, event, habit, shop item and job is reachable
and runs without a single expression error, every flag and counter a condition asks about is set somewhere,
and whole simulated lives play out cleanly. Uses a fake room, no server."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import contextlib
import io
import random
import re

failed = 0


def check(cond, label):
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


out = io.StringIO()
with contextlib.redirect_stdout(out):
    from games.life import game as G
check("Problems in Family Life data" not in out.getvalue(), "every expression in the data files compiles" + out.getvalue()[:400])
D = G.D


class M:
    def __init__(self, uid):
        self.uid, self.name, self.avatar, self.color = uid, uid.upper(), "🙂", "#fff"
        self.watching = False
        self.client = object()
        self.account = None
        self.inbox = []
    online = property(lambda self: self.client is not None)
    plays = property(lambda self: self.client is not None and not self.watching)
    def send(self, t, **d): self.inbox.append((t, d))


class Hub:
    def record(self, *a, **k): pass


class Room:
    def __init__(self, ms):
        self.members = {m.uid: m for m in ms}
        self.host = ms[0].uid
        self.hub = Hub()
    def players_now(self): return [m for m in self.members.values() if m.plays]
    def broadcast(self, t, exclude=None, **d):
        for m in self.members.values():
            if m.uid != exclude: m.send(t, **d)
    def send(self, uid, t, **d):
        if uid in self.members: self.members[uid].send(t, **d)
    def system(self, text): pass
    def later(self, delay, fn, *a): return [delay, fn, a]
    def cancel(self, h): pass
    def game_over(self, groups): pass


def new_game(n=3, seed=None, pace="quarter"):
    random.seed(seed)
    ms = [M(c) for c in "abcd"[:n]]
    g = G.Life(Room(ms))
    g.settings["pace"] = pace
    for m in ms:
        g.on_message(m, "char", {"first": "Kid" + m.uid, "gender": random.choice("mf")})
        g.on_message(m, "ready", {"ready": True})
    g.on_message(ms[0], "start", {})
    return g, ms


errors = io.StringIO()      # the engine prints a traceback for every expression that fails at runtime

# ------------------------------------------------------------------ every flag and counter a condition uses is set somewhere
set_flags, set_counters, used_flags, used_counters = set(D["habits"]), set(), set(), set()


def scan(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("flag", "unflag"):
                set_flags.update(v if isinstance(v, list) else [v])
            elif k == "count" and isinstance(v, str):
                set_counters.add(v)
            scan(v)
    elif isinstance(obj, list):
        for v in obj:
            scan(v)
    elif isinstance(obj, str):
        used_flags.update(re.findall(r"\bf_(\w+)", obj))
        used_counters.update(re.findall(r"\bc_(\w+)", obj))


scan([D["actions"], D["events"], D["happenings"], D["shop"], D["sib_actions"], D["group"], D["family_events"], D["habits"], D["jobs"]])
set_flags.update(j["flag"] for j in D["jobs"].values() if j.get("flag"))
check(used_flags <= set_flags, f"every flag a condition checks can be switched on ({sorted(used_flags - set_flags)})")
check(used_counters <= set_counters | {"chaos", "crimes", "pranks", "arguments", "gifts", "hangouts", "casino_net"},
      f"every counter a condition checks gets counted ({sorted(used_counters - set_counters)})")
check(len({a["id"] for a in D["actions"]}) == len(D["actions"]), "action ids are unique")
TABS = {"activities", "school", "friends", "hobbies", "fun", "health", "career", "family", "love", "kids", "money", "travel", "rich", "fame", "risky", "jail", "hidden"}
check(all(a.get("cat") in TABS for a in D["actions"]), f"every action is in a tab {[a['id'] for a in D['actions'] if a.get('cat') not in TABS]}")
for f, h in D["habits"].items():
    if h.get("fade") is not None or h.get("until") is not None:
        pass
check(all("label" in h for h in D["habits"].values()), "every habit has a label")

# ------------------------------------------------------------------ random people to try things with
g, ms = new_game(3, seed=1)
A = ms[0]
s = g.sib_of("a")
ITEMS = [i["id"] for i in D["shop"]]


def randomize(s, rng):
    s.age = rng.choice([rng.randint(0, 17), rng.randint(13, 30), rng.randint(18, 90), rng.randint(55, 100)])
    s.money = rng.choice([0, 300, 3000, 30000, 400000, 3_000_000, 40_000_000, 120_000_000])
    s.jail = rng.choice([0, 0, 0, 0, 3])
    s.heat = rng.choice([0, 20, 60])
    for k in ("health", "happy", "smarts", "looks", "fame", "karma", "music", "sport"):
        setattr(s, k, rng.choice([5, 40, 70, 95]))
    s.flags = set(rng.sample(sorted(set_flags), rng.randint(0, 12)))
    s.friends = [{"name": f"F{i}", "rel": rng.randint(20, 90), "since": 1} for i in range(rng.randint(0, 3))]
    s.partner = None if rng.random() < 0.4 else {"first": "Pat", "name": "Pat Doe", "married": rng.random() < 0.5, "years": rng.randint(0, 20)}
    s.kids = [{"name": "Kid", "born": max(0, s.age - 5)}] * rng.randint(0, 2) if s.age >= 18 else []
    s.pets = [{"name": "Rex", "kind": "dog", "emoji": "🐶", "born": 0}] if rng.random() < 0.3 else []
    s.job = None
    if s.age >= 18 and rng.random() < 0.6:
        key = rng.choice(sorted(D["jobs"]))
        j = D["jobs"][key]
        s.job = {"key": key, "title": j["title"], "emoji": j["emoji"], "salary": j["salary"], "level": 0, "perf": 30, "years": 2}
    s.uni = {"major": rng.choice(sorted(D["majors"])), "years": 1} if 18 <= s.age <= 40 and rng.random() < 0.2 else None
    s.degrees = rng.sample(sorted(D["majors"]), rng.randint(0, 2)) if s.age >= 22 else []
    s.counters = {**s.counters, **{c: rng.choice([0, 2, 5]) for c in set_counters}}
    s.assets = []
    if s.age >= 18:
        for iid in rng.sample(ITEMS, rng.randint(0, 6)):
            g.add_asset(s, D["shop_map"][iid])
    s.living = rng.choice(["home", "own", "together"])
    s.city = rng.choice([None, None, "🇯🇵 Tokyo, Japan"])
    s.retired = s.age >= 60 and rng.random() < 0.3
    s.event = None
    s.alive = True


rng = random.Random(7)
ran, never = set(), []
with contextlib.redirect_stderr(errors):
    for a in D["actions"]:
        if a.get("client") or a.get("cat") == "hidden":
            continue
        done = 0
        for _ in range(1200):
            randomize(s, rng)
            if not G.check(a.get("cond"), g.env(s)):
                continue
            s.energy, s.done, s.event = 4, set(), None
            g.on_message(A, "act", {"a": a["id"]})
            done += 1
            if done >= 4:
                break
        if done:
            ran.add(a["id"])
        else:
            never.append(a["id"])
check(not never, f"every action can be done by somebody ({never})")
check(errors.getvalue() == "", "doing every action never hits an expression error " + errors.getvalue()[-600:])
check(len(ran) >= 340, f"{len(ran)} actions tried")

# ------------------------------------------------------------------ every event, every choice
errors.truncate(0), errors.seek(0)
made, unmade = 0, []
with contextlib.redirect_stderr(errors):
    for ev in D["events"]:
        ok = False
        for _ in range(600):
            randomize(s, rng)
            if not ev.get("scripted"):
                lo, hi = ev.get("ages", [0, 120])
                s.age = rng.randint(lo, min(hi, 100))
                s.jail = 0
            for o in g.sibs.values():          # brothers and sisters: sometimes a twin
                if o is not s:
                    o.alive = True
                    o.age = s.age if rng.random() < 0.4 else max(0, s.age + rng.randint(-8, 8))
            e = g.make_event(ev, s, forced=bool(ev.get("scripted")))
            if not e:
                continue
            for i in range(len(e["choices"])):
                s.event = g.make_event(ev, s, forced=True) or e
                if i < len(s.event["choices"]):
                    g.resolve_event(s, i)
            ok = True
            made += 1
            break
        if not ok:
            unmade.append(ev["id"])
check(not unmade, f"every event can happen to somebody ({unmade})")
check(errors.getvalue() == "", "every choice of every event runs cleanly " + errors.getvalue()[-600:])

# ------------------------------------------------------------------ habits, happenings, family events
errors.truncate(0), errors.seek(0)
with contextlib.redirect_stderr(errors):
    for _ in range(300):
        randomize(s, rng)
        s.flags = set(rng.sample(sorted(D["habits"]), 8))
        s.job = s.job or None
        g.yearly_habits(s)
        g.happening(s)
    for fe in D["family_events"]:
        g.family_fx(fe.get("family", {}), g.fctx())
check(errors.getvalue() == "", "habits and happenings run cleanly " + errors.getvalue()[-600:])
randomize(s, rng)
s.age, s.flags = 18, {"chess_club", "soccer_team", "grounded"}
g.yearly_habits(s)
check("chess_club" not in s.flags and "soccer_team" not in s.flags, "school clubs end when you finish school")
s.flags, s.money = {"gym_member"}, 10000
g.yearly_habits(s)
check(s.money == 10000 - 900, "memberships cost money every year")
s.friends = [{"name": "Old", "rel": 12, "since": 1}]
for _ in range(10):
    g.yearly_habits(s)
check(not s.friends, "friends you never see drift apart")

# ------------------------------------------------------------------ friends, licences, moving abroad, grad school
randomize(s, rng)
s.age, s.jail, s.money, s.friends, s.flags = 25, 0, 50000, [], set()
for _ in range(3):
    g.apply_fx(s, {"friend": True})
check(len(s.friends) == 3 and len({x["name"] for x in s.friends}) == 3, "you can make friends (all different)")
s.focus = s.friends[0]["name"]
g.apply_fx(s, {"friend_rel": 40})
check(s.friends[0]["rel"] >= 90 or s.friends[0]["rel"] == 100, "spending time with a friend makes you closer")
here = g.family.place
g.apply_fx(s, {"emigrate": True})
check(s.city and s.city != here and g.me(s)["place"] == s.city, "moving abroad changes where you live")
g.apply_fx(s, {"home_city": True})
check(s.city is None, "…and you can move back")
sedan = D["shop_map"]["sedan"]
ok, why = g.can_buy(s, sedan, g.env(s))
check(not ok and "licence" in (sedan.get("desc") or "").lower(), "cars need a driver's licence")
s.flags.add("driver")
ok, why = g.can_buy(s, sedan, g.env(s))
check(ok, f"…and with one you can buy a car ({why})")
s.degrees, s.smarts = ["biology"], 90
env = g.env(s)
check(env["bachelors"] == 1 and G.check(D["action_map"]["grad_school"]["cond"], env), "a bachelor's degree opens grad school")
s.uni, s.energy = None, 4
g.apply_fx(s, {"uni": "phd"})
for _ in range(4):
    g.age_up(s)
    if not s.alive:
        break
check("phd" in s.degrees, "a PhD takes 4 years")
s.flags.add("pilot")
s.degrees, s.smarts, s.health = ["aviation"], 80, 80
check(g.job_check(s, "pilotjob")[0] and not g.job_check(s, "president")[0], "jobs check licences and fame")
g.apply_fx(s, {"job": "soldier"})
check(s.job and s.job["key"] == "soldier", "joining the army gives you the job")

# ------------------------------------------------------------------ every shop item can be bought by somebody
errors.truncate(0), errors.seek(0)
bought = 0
with contextlib.redirect_stderr(errors):
    for it in D["shop"]:
        randomize(s, rng)
        s.age, s.jail, s.money, s.energy, s.done = 40, 0, 500_000_000, 4, set()
        s.flags = {"driver", "boater", "pilot"}
        s.kids = [{"name": "Kid", "born": 30}]
        s.assets, s.once, s.bought = [], set(), set()
        for need in ("house", "jet"):        # what some items need (a pool needs a house...)
            if need != it["id"]:
                g.add_asset(s, D["shop_map"][need])
        before = s.owns(it["id"])
        g.buy(A, s, it["id"])
        if s.owns(it["id"]) > before or it["cat"] == "fun":
            bought += 1
check(bought == len(D["shop"]), f"every one of the {len(D['shop'])} shop items can be bought ({bought})")
check(errors.getvalue() == "", "buying runs cleanly " + errors.getvalue()[-400:])

# ------------------------------------------------------------------ every job can be held by somebody
can = 0
for key in D["jobs"]:
    randomize(s, rng)
    s.age, s.jail, s.uni, s.retired = 45, 0, None, False
    for k in ("health", "smarts", "looks", "music", "sport", "fame"):
        setattr(s, k, 100)
    s.degrees, s.flags, s.job = sorted(D["majors"]), {"driver", "boater", "pilot"}, None
    can += g.job_check(s, key)[0]
check(can == len(D["jobs"]), f"every one of the {len(D['jobs'])} jobs is possible to get ({can})")

# ------------------------------------------------------------------ whole lives
errors.truncate(0), errors.seek(0)
years = deaths = done_acts = 0
with contextlib.redirect_stderr(errors):
    for seed in range(6):
        g, ms = new_game(3, seed=100 + seed, pace="year" if seed % 2 else "quarter")
        r = random.Random(seed)
        for _ in range(140 if seed % 2 else 60):
            if g.phase != "playing":
                break
            for m in ms:
                x = g.sib_of(m.uid)
                if not x or not x.alive:
                    continue
                me = g.me(x)
                acts = [a for a in me["actions"] if not a["client"] and not a["done"]]
                for a in r.sample(acts, min(len(acts), x.energy)):
                    g.on_message(m, "act", {"a": a["id"]})
                    done_acts += 1
                if me["jobs"] and r.random() < 0.3:
                    ok = [j for j in me["jobs"] if j["ok"]]
                    if ok and x.energy > 0:
                        g.on_message(m, "act", {"a": "apply", "job": r.choice(ok)["key"]})
                if x.event:
                    g.on_message(m, "choose", {"i": r.randrange(len(x.event["choices"]))})
                for o in g.alive():
                    if o is not x and r.random() < 0.3:
                        acts = g.sib_available(x, o)
                        if acts:
                            g.on_message(m, "sib", {"a": r.choice(acts), "target": o.cid})
            g.end_turn()
            years += 1
            for x in g.sibs.values():
                assert all(0 <= getattr(x, k) <= 100 for k in ("health", "happy", "smarts", "looks", "fame", "karma", "music", "sport")), x.first
                assert isinstance(x.money, int)
        deaths += sum(1 for x in g.sibs.values() if not x.alive)
check(errors.getvalue() == "", "six whole family lives play out with no errors " + errors.getvalue()[-800:])
check(years > 100 and done_acts > 1000 and deaths >= 9, f"{years} turns played, {done_acts} actions done, {deaths} siblings lived a whole life")

print("FAILED:", failed)
