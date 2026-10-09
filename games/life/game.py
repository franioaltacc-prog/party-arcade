"""Family Life - 1 to 4 players are siblings in the same family.

* Nobody ages alone: "+ Age" starts a vote and everyone must say yes.
* Solo actions need no vote, sibling actions can need the target's OK,
  group actions (vacations, running away, businesses...) are voted on.
* All events and actions come from ./data/*.json.
"""
import random
import time

from ..base import Game, num as clean_num
from . import engine
from .engine import (EXTRA, LEVELS, PLAIN_LETS, SEASONS, STATS, Family, Sibling, check, evaluate, fmt, jail_str,
                     money_str, num, pick_weighted)

START_YEAR = 2026
VOTE_TIMEOUTS = (15, 30, 60, 90)
REQUEST_TTL = 40
DESTINATIONS = ["Hawaii 🌺", "Paris 🗼", "Tokyo 🗾", "Disney World 🏰", "the Grand Canyon 🏜️", "Bali 🏝️",
                "Iceland 🧊", "Rome 🍝", "a theme park 🎢", "the beach 🏖️"]
HEIST_ROLES = [("🧠 Mastermind", "smarts"), ("💻 Hacker", "smarts"), ("🚗 Getaway driver", "sport"),
               ("💪 Muscle", "health"), ("🎭 Distraction", "looks")]
SCALED = {"health", "happy", "smarts", "looks", "fame", "music", "sport", "perf"}
BUSINESSES = ["{last} Bros Burgers 🍔", "{last} & Co. Tech 💻", "Sibling Slime Shop 🟢", "{last} Family Bakery 🥐",
              "The {last} Escape Room 🔐", "{last} Pet Hotel 🐶", "Double Trouble Coffee ☕"]

D = {}


def reload_data():
    """(Re)load the JSON data files. Called at import and at the start of every game,
    so edits to the data files show up in the next game without a restart."""
    data = engine.load_data()
    D.clear()
    D.update(
        names=data["names"], jobs=data["jobs"], majors=data["names"]["majors"],
        events=[e for e in data["events"]["events"]],
        events_by_id={e["id"]: e for e in data["events"]["events"]},
        happenings=data["events"].get("happenings", []),
        family_events=data["family_events"]["events"],
        family_chance=data["family_events"].get("chance_per_year", 0.3),
        actions=data["actions"]["actions"],
        action_map={a["id"]: a for a in data["actions"]["actions"]},
        sib_actions=data["sibling_actions"]["actions"],
        sib_map={a["id"]: a for a in data["sibling_actions"]["actions"]},
        group=data["group_actions"]["actions"],
        group_map={a["id"]: a for a in data["group_actions"]["actions"]},
    )


reload_data()


def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, int(v)))


def join_names(names):
    names = list(names)
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " & " + names[-1]


class Life(Game):
    key = "life"
    max_players = 4

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"familyType": "siblings", "gapMode": "random", "gap": 2, "voteTimeout": 30,
                         "offline": "skip", "pace": "quarter",
                         "rules": {g["id"]: g.get("rule", "majority") for g in D["group"]}}
        self.family = Family(D["names"])
        self.chars = {}
        self.reset_play()

    def reset_play(self):
        self.sibs = {}
        self.pairs = {}
        self.debts = {}
        self.vote = None
        self.vote_timer = None
        self.vote_seq = 0
        self.requests = {}
        self.req_seq = 0
        self.year = START_YEAR
        self.q = 1
        self.t = 0
        self.ranking = None
        self.awards = None
        self.cooldown = {}

    def listed(self):
        return self.phase in ("lobby", "over")

    @property
    def quarterly(self):
        return self.settings.get("pace", "quarter") == "quarter"

    def when(self, year=None, q=None):
        return f"{SEASONS[q or self.q]} {year or self.year}"

    # ------------------------------------------------------------------ helpers
    def alive(self):
        return [s for s in self.sibs.values() if s.alive]

    def sib_of(self, uid):
        return next((s for s in self.sibs.values() if s.owner == uid), None)

    def member_of(self, s):
        return self.room.members.get(s.owner)

    def online(self, s):
        m = self.member_of(s)
        return bool(m and m.online)

    def full(self, s):
        return f"{s.first} {self.family.last}"

    def pair(self, a, b):
        return self.pairs.setdefault(tuple(sorted((a.cid, b.cid))), {"rel": 50, "best": False, "silent": False, "since": None})

    def rel(self, a, b):
        return self.pair(a, b)["rel"]

    def toast(self, s, text, delta=None, warn=False):
        m = self.member_of(s)
        if m:
            m.send("g:toast", text=text, delta=delta or [], warn=warn)

    def notify(self, s, text, log=True):
        if log:
            s.add_log(text)
        m = self.member_of(s)
        if m:
            m.send("g:notify", text=text)

    def flog(self, text):
        self.family.log.append({"year": self.year, "q": self.q, "text": text})
        del self.family.log[:-150]

    def announce(self, text):
        self.broadcast("announce", text=text)

    def bond(self, a, b, delta):
        if a is b:
            return
        p = self.pair(a, b)
        delta = int(delta)
        if p["silent"] and delta > 0:
            delta = min(delta, max(0, 10 - p["rel"]))
        p["rel"] = clamp(p["rel"] + delta)
        if not (a.alive and b.alive):
            return
        if p["rel"] >= 85 and not p["best"] and not p["silent"]:
            p["best"] = True
            for x, y in ((a, b), (b, a)):
                x.achieve("👯 Sibling besties")
                self.notify(x, f"👯 You and {y.first} are now BEST FRIENDS!")
            self.flog(f"👯 {a.first} and {b.first} are now best friends!")
        elif p["best"] and p["rel"] < 60:
            p["best"] = False
        if p["rel"] <= 10 and not p["silent"]:
            p.update(silent=True, best=False, since=self.year)
            for x, y in ((a, b), (b, a)):
                self.notify(x, f"🙊 You and {y.first} stopped speaking to each other.")
            self.flog(f"🙊 {a.first} and {b.first} aren't speaking to each other anymore.")

    def rel_all(self, group, value):
        group = list(group)
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                self.bond(a, b, num(value, {}))

    def new_partner(self, s):
        names = D["names"]
        pool = names["first_f"] if s.gender == "m" else names["first_m"]
        first = random.choice(pool) if random.random() < 0.85 else random.choice(names["first_m"] + names["first_f"])
        s.partner = {"name": f"{first} {random.choice(names['last'])}", "first": first, "married": False, "years": 0}

    def add_pet(self, pets, born):
        emoji, kind = random.choice(D["names"]["pets"])
        pets.append({"emoji": emoji, "kind": kind, "name": random.choice(D["names"]["pet_names"]), "born": born})

    def send_to_jail(self, s, years):
        s.jail += years * 4
        s.jail_total += years
        if s.job:
            s.add_log(f"🚪 You lost your job as a {s.job['title']}.")
            s.job = None
        s.uni = None
        s.achieve("🔒 Jailbird")

    # ------------------------------------------------------------------ expression environments
    def env(self, s, sib=None):
        f = self.family
        others = [o for o in self.alive() if o is not s]
        parents = f.parents()
        rels = [s.rel_mom if p is f.mom else s.rel_dad for p in parents]
        e = {
            "age": s.age, "money": s.money, "worth": s.worth(), "jail": s.jail, "in_jail": s.jail > 0,
            "in_uni": bool(s.uni), "has_job": bool(s.job),
            "star_job": bool(s.job and D["jobs"].get(s.job["key"], {}).get("star")),
            "has_partner": bool(s.partner), "married": bool(s.partner and s.partner["married"]),
            "partner_years": s.partner["years"] if s.partner else 0, "kids": len(s.kids), "pets": len(s.pets),
            "has_car": s.has_asset("car"), "has_house": s.has_asset("house"), "has_mansion": s.has_asset("mansion"),
            "retired": s.retired, "degrees": len(s.degrees), "living_home": s.living == "home",
            "male": s.gender == "m", "female": s.gender == "f", "siblings": len(others),
            "is_twin": any(o.age == s.age for o in others), "is_oldest": all(o.age < s.age for o in others),
            "is_youngest": all(o.age > s.age for o in others), "mom_alive": f.mom["alive"], "dad_alive": f.dad["alive"],
            "parents_alive": len(parents), "rel_mom": s.rel_mom, "rel_dad": s.rel_dad,
            "rel_parents_avg": sum(rels) / len(rels) if rels else 50, "family_money": f.money,
            "has_event": bool(s.event), "year": self.year, "quarter": self.q,
        }
        for k in STATS + EXTRA:
            e[k] = getattr(s, k)
        if sib:
            e.update(sib_age=sib.age, sib_smarts=sib.smarts, sib_rel=self.rel(s, sib), sib_money=sib.money, sib_health=sib.health)
        else:
            e.update(sib_age=0, sib_smarts=0, sib_rel=0, sib_money=0, sib_health=0)
        return e

    def sib_env(self, s, t):
        e = self.env(s, t)
        for k in STATS + EXTRA:
            e["t_" + k] = getattr(t, k)
        p = self.pair(s, t)
        e.update(t_age=t.age, t_money=t.money, t_jail=t.jail, rel=p["rel"], silent=p["silent"], twins=s.age == t.age,
                 owes=self.debts.get((s.cid, t.cid), 0), t_owes=self.debts.get((t.cid, s.cid), 0))
        return e

    def ctx(self, s, sib=None):
        f = self.family
        pet = s.pets[-1] if s.pets else None
        return {"first": s.first, "last": f.last, "name": self.full(s), "age": s.age,
                "sib": sib.first if sib else "your sibling", "mom": f.mom["first"], "dad": f.dad["first"],
                "partner": s.partner["first"] if s.partner else "your partner",
                "kid": s.kids[-1]["name"] if s.kids else "your kid",
                "pet": pet["name"] if pet else "your pet", "petkind": pet["kind"] if pet else "pet",
                "petemoji": pet["emoji"] if pet else "🐾", "city": f.place.split(" ", 1)[-1]}

    def old_parent(self):
        cands = [p for p in self.family.parents() if not p["care"] and (p["age"] >= 70 or p["health"] < 30)]
        return max(cands, key=lambda p: p["age"]) if cands else None

    def fenv(self):
        f = self.family
        al = self.alive()
        ages = [s.age for s in al] or [0]
        parents = f.parents()
        return {"youngest_age": min(ages), "oldest_age": max(ages), "minors": sum(1 for s in al if s.age < 18),
                "siblings": len(al), "parents_married": f.married, "parents_alive": len(parents),
                "mom_alive": f.mom["alive"], "dad_alive": f.dad["alive"], "family_money": f.money,
                "family_pets": len(f.pets), "pet_age": max((self.year - p["born"] for p in f.pets), default=0),
                "inheritance": f.inheritance, "old_parent": bool(self.old_parent()),
                "oldest_parent_age": max((p["age"] for p in parents), default=0), "year": self.year, "quarter": self.q,
                "at_home": sum(1 for s in al if s.living == "home")}

    def fctx(self, involved=None):
        f = self.family
        parents = f.parents()
        par = random.choice(parents) if parents else None
        oldp = self.old_parent()
        pet = min(f.pets, key=lambda p: p["born"]) if f.pets else None
        newplace = random.choice([p for p in D["names"]["places"] if p != f.place])
        return {"last": f.last, "mom": f.mom["first"], "dad": f.dad["first"], "parent": par["first"] if par else "Grandma",
                "_parent": par, "place": f.place, "city": f.place.split(" ", 1)[-1],
                "destination": random.choice(DESTINATIONS), "newplace": newplace.split(" ", 1)[-1], "_newplace": newplace,
                "petname": pet["name"] if pet else "", "petkind": pet["kind"] if pet else "", "petemoji": pet["emoji"] if pet else "",
                "inheritance": money_str(f.inheritance), "oldparent": oldp["first"] if oldp else "Grandma",
                "names": join_names(s.first for s in (involved if involved is not None else self.alive())), "amount": ""}

    # ------------------------------------------------------------------ effects
    def apply_fx(self, s, fx, sib=None, env=None, scale=1.0):
        """Apply a dict of effects to sibling s. Returns extra sentences to show.
        `scale` shrinks stat gains (used for solo actions in quarter mode)."""
        if not fx or not s.alive:
            return []
        env = env if env is not None else self.env(s, sib)
        extra = []
        nxt = None
        for k, v in fx.items():
            if k in STATS or k in EXTRA:
                d = num(v, env)
                if scale != 1.0 and k in SCALED and d:
                    d = int(round(d * scale)) or (1 if d > 0 else -1)
                s.add(k, d)
            elif k == "money":
                s.money += num(v, env)
            elif k in ("rel_mom", "rel_dad", "rel_parents"):
                d = num(v, env)
                if k != "rel_dad":
                    s.rel_mom = clamp(s.rel_mom + d)
                if k != "rel_mom":
                    s.rel_dad = clamp(s.rel_dad + d)
            elif k == "perf":
                if s.job:
                    s.job["perf"] += int(round(num(v, env) * scale))
            elif k == "raise":
                if s.job:
                    s.job["salary"] = int(s.job["salary"] * (1 + float(evaluate(v, env))))
            elif k in ("fire", "quit"):
                if v and s.job:
                    s.job = None
            elif k == "retire":
                if v and s.job:
                    s.pension = int(s.job["salary"] * 0.45)
                    s.job = None
                    s.retired = True
            elif k == "partner":
                if not s.partner:
                    self.new_partner(s)
            elif k == "marry":
                if v and s.partner:
                    s.partner["married"] = True
                    s.ever_married = True
                    s.achieve("💍 Married")
            elif k == "breakup":
                if v:
                    s.partner = None
            elif k == "kid":
                if v:
                    names = D["names"]
                    s.kids.append({"name": random.choice(names["first_m"] + names["first_f"]), "born": s.age})
                    s.achieve("👶 Parent")
            elif k == "pet":
                if v:
                    self.add_pet(s.pets, s.age)
            elif k == "asset":
                kind, name, value = v
                if not s.has_asset(kind):
                    s.assets.append({"kind": kind, "name": name, "value": value})
            elif k == "ach":
                s.achieve(v)
            elif k == "uni":
                key = v if v in D["majors"] else "arts"
                title, _, need = D["majors"][key]
                if s.smarts < need:
                    extra.append(f"😬 Your grades weren't good enough for {title} (needs 🧠 {need}). You enrolled in Arts instead!")
                    key = "arts"
                s.uni = {"major": key, "years": 0}
                if s.job and not D["jobs"].get(s.job["key"], {}).get("part"):
                    extra.append(f"You left your job as a {s.job['title']} to study.")
                    s.job = None
            elif k == "dropout":
                if v:
                    s.uni = None
            elif k == "next":
                nxt = v
            elif k == "jail":
                n = num(v, env)
                if n > 0:
                    self.send_to_jail(s, n)
                elif n < 0:
                    s.jail = max(0, s.jail + n)
            elif k == "jail_q":
                s.jail = max(0, s.jail + num(v, env))
            elif k == "jail_set":
                s.jail = max(0, num(v, env))
            elif k == "living":
                if v in ("home", "own", "together"):
                    s.living = v
            elif k == "sib_rel":
                if sib:
                    self.bond(s, sib, num(v, env))
            elif k == "sib_fx":
                if sib and sib.alive and isinstance(v, dict):
                    self.apply_fx(sib, v, s)
            elif k == "chaos":
                s.counters["chaos"] += num(v, env)
            elif k == "count":
                s.counters[v] = s.counters.get(v, 0) + 1
            elif k == "unsilence":
                if v and sib:
                    p = self.pair(s, sib)
                    p["silent"] = False
                    p["rel"] = max(p["rel"], 45)
            elif k == "die":
                self.kill(s, str(v))
        if fx.get("log"):
            self.flog(fmt(fx["log"], self.ctx(s, sib)))
        if nxt:
            ev = D["events_by_id"].get(nxt)
            if ev:
                s.event = self.make_event(ev, s, forced=True)
        return extra

    def family_fx(self, fx, ctx):
        f = self.family
        for k, v in fx.items():
            if k == "money":
                f.money = max(0, f.money + num(v, self.fenv()))
            elif k == "divorce":
                f.married = False
            elif k == "remarry":
                f.married = True
            elif k == "move":
                f.place = ctx["_newplace"]
            elif k == "pet_add":
                self.add_pet(f.pets, self.year)
                pet = f.pets[-1]
                ctx.update(petname=pet["name"], petkind=pet["kind"], petemoji=pet["emoji"])
            elif k == "pet_die":
                if f.pets:
                    f.pets.remove(min(f.pets, key=lambda p: p["born"]))
            elif k == "inheritance":
                amt = num(v, self.fenv())
                f.inheritance += amt
                f.inheritance_year = self.year
                ctx["amount"] = money_str(amt)
                ctx["inheritance"] = money_str(f.inheritance)
            elif k == "parent_health":
                p = ctx.get("_parent")
                if p:
                    p["health"] = clamp(p["health"] + num(v, {}))

    # ------------------------------------------------------------------ events
    def pick_sib(self, s, kind):
        others = [o for o in self.alive() if o is not s]
        if kind == "twin":
            others = [o for o in others if o.age == s.age]
        elif kind == "older":
            others = [o for o in others if o.age > s.age]
        elif kind == "younger":
            others = [o for o in others if o.age < s.age]
        return random.choice(others) if others else None

    def make_event(self, ev, s, forced=False, sib=None):
        kind = ev.get("sib")
        if sib is None and kind:
            sib = self.pick_sib(s, kind)
        if kind in ("twin", "older", "younger") and not sib:
            return None
        env = self.env(s, sib)
        if not forced and not check(ev.get("cond"), env):
            return None
        choices = [c for c in ev["choices"] if check(c.get("cond"), env)]
        if not choices:
            return None
        s.seen[ev["id"]] = s.age
        ctx = self.ctx(s, sib)
        return {"id": ev["id"], "text": fmt(ev["text"], ctx), "choices": choices,
                "labels": [fmt(c["label"], ctx) for c in choices], "sib": sib.cid if sib else None}

    def event_ok(self, ev, s):
        if ev.get("scripted"):
            return False
        lo, hi = ev.get("ages", [0, 200])
        if not lo <= s.age <= hi:
            return False
        if ev.get("seasons") and self.quarterly and self.q not in ev["seasons"]:
            return False
        if ev["id"] in s.seen and (ev.get("once") or s.age - s.seen[ev["id"]] < 6):
            return False
        return True

    def pick_event(self, s):
        if s.age == 18 and s.jail == 0 and "grad" not in s.seen:
            return self.make_event(D["events_by_id"]["grad"], s, forced=True)
        if s.age == 0 or s.jail or random.random() > (0.32 if self.quarterly else 0.55):
            return None
        pool = [e for e in D["events"] if self.event_ok(e, s)]
        for _ in range(6):
            if not pool:
                break
            ev = random.choices(pool, weights=[e.get("weight", 1) for e in pool])[0]
            made = self.make_event(ev, s)
            if made:
                return made
            pool.remove(ev)
        return None

    def resolve_event(self, s, i):
        ev = s.event
        s.event = None
        choice = ev["choices"][i]
        label = ev["labels"][i]
        sib = self.sibs.get(ev["sib"]) if ev["sib"] else None
        if sib and not sib.alive:
            sib = None
        env = self.env(s, sib)
        out = pick_weighted(choice["outcomes"], env) or {"text": "Nothing happened.", "fx": {}}
        before = s.snap()
        extra = self.apply_fx(s, out.get("fx", {}), sib, env)
        text = " ".join([fmt(out.get("text", ""), self.ctx(s, sib))] + extra)
        s.last_delta = s.diff(before)
        s.add_log(f"{ev['text']} → {label}: {text}")
        return text

    # ------------------------------------------------------------------ messages
    def on_message(self, m, t, msg):
        if self.phase in ("lobby", "over"):
            self.lobby_message(m, t, msg)
            return
        s = self.sib_of(m.uid)
        if t == "claim":
            self.claim(m, msg)
        elif t == "end" and self.is_host(m):
            for x in self.alive():
                self.kill(x, "the end of the simulation 🌌")
            self.check_over()
        elif not s or not s.alive:
            return
        elif t == "act":
            self.do_action(m, s, msg)
        elif t == "sib":
            self.do_sib_action(m, s, msg)
        elif t == "respond":
            self.respond(m, s, msg)
        elif t == "choose":
            i = msg.get("i")
            if s.event and isinstance(i, int) and 0 <= i < len(s.event["choices"]):
                text = self.resolve_event(s, i)
                m.send("g:toast", text=text, delta=s.last_delta)
                self.after_change()
        elif t == "vote_start":
            self.vote_start(m, s, msg)
        elif t == "vote":
            self.cast_vote(s, msg)

    def lobby_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "char":
            c = self.chars.setdefault(m.uid, self.default_char())
            first = "".join(ch for ch in str(msg.get("first") or "") if ch.isalpha() or ch in " -'").strip()[:14]
            if first:
                c["first"] = first[0].upper() + first[1:]
            if msg.get("gender") in ("m", "f"):
                c["gender"] = msg["gender"]
            self.push()
        elif t == "ready":
            self.chars.setdefault(m.uid, self.default_char())["ready"] = bool(msg.get("ready"))
            self.push()
        elif t == "settings" and host:
            s = self.settings
            if msg.get("familyType") in ("siblings", "twins"):
                s["familyType"] = msg["familyType"]
            if msg.get("gapMode") in ("random", "fixed"):
                s["gapMode"] = msg["gapMode"]
            if "gap" in msg:
                s["gap"] = int(clean_num(msg["gap"], 2, 1, 5))
            if msg.get("voteTimeout") in VOTE_TIMEOUTS:
                s["voteTimeout"] = msg["voteTimeout"]
            if msg.get("offline") in ("skip", "abstain"):
                s["offline"] = msg["offline"]
            if msg.get("pace") in ("quarter", "year"):
                s["pace"] = msg["pace"]
            rules = msg.get("rules")
            if isinstance(rules, dict):
                for k, v in rules.items():
                    if k in s["rules"] and v in ("unanimous", "majority", "optin"):
                        s["rules"][k] = v
            self.push()
        elif t == "reroll" and host:
            self.family = Family(D["names"])
            self.push()
        elif t == "start" and host:
            self.start(m)

    def default_char(self):
        g = random.choice("mf")
        names = D["names"]
        return {"first": random.choice(names["first_m"] if g == "m" else names["first_f"]), "gender": g, "ready": False}

    def claim(self, m, msg):
        if self.sib_of(m.uid):
            return
        s = self.sibs.get(msg.get("cid"))
        if s and s.alive and not self.online(s):
            old = s.player
            s.owner = m.uid
            s.player, s.avatar, s.color = m.name, m.avatar, m.color
            self.flog(f"🔄 {m.name} took over {s.first}'s life (from {old}).")
            self.push()

    # ------------------------------------------------------------------ lobby flow
    def on_join(self, m, rejoin):
        if self.phase in ("lobby", "over") and m.uid not in self.chars:
            self.chars[m.uid] = self.default_char()
        s = self.sib_of(m.uid)
        if s:
            s.player, s.avatar, s.color = m.name, m.avatar, m.color
        self.push()

    def on_offline(self, m):
        s = self.sib_of(m.uid)
        if s and self.vote and s.cid in self.vote["voters"] and s.cid not in self.vote["votes"]:
            if self.settings["offline"] == "skip":
                self.vote["voters"].remove(s.cid)
            else:
                self.vote["votes"][s.cid] = "abstain"
            self.tally()
        self.push()

    def on_leave(self, m):
        if self.phase in ("lobby", "over"):
            self.chars.pop(m.uid, None)
        self.on_offline(m)

    def start(self, m):
        reload_data()
        players = self.room.online_members()
        waiting = [p.name for p in players if not self.chars.get(p.uid, {}).get("ready")]
        if waiting:
            m.send("error", msg="Waiting for " + join_names(waiting) + " to press Ready ✋")
            return
        for k, v in list(self.settings["rules"].items()):
            if k not in D["group_map"]:
                del self.settings["rules"][k]
        for g in D["group"]:
            self.settings["rules"].setdefault(g["id"], g.get("rule", "majority"))
        self.reset_play()
        order = list(players)
        random.shuffle(order)
        n = len(order)
        if self.settings["familyType"] == "twins":
            ages = [0] * n
        else:
            gaps = [self.settings["gap"] if self.settings["gapMode"] == "fixed" else random.randint(1, 5) for _ in range(n - 1)]
            ages = [sum(gaps[i:]) for i in range(n)]
        f = self.family
        f.log = []
        f.mom["age"] += ages[0]
        f.dad["age"] += ages[0]
        for i, mm in enumerate(order):
            c = self.chars[mm.uid]
            s = Sibling(f"c{i + 1}", mm.uid, mm, c["first"], c["gender"], ages[i])
            self.sibs[s.cid] = s
        sibs = list(self.sibs.values())
        for i, a in enumerate(sibs):
            for b in sibs[i + 1:]:
                self.pair(a, b)["rel"] = random.randint(50, 64) if a.age == b.age else random.randint(40, 56)
        if n > 1 and self.settings["familyType"] == "twins":
            self.flog(f"👯 Surprise! The {f.last} family had {['', '', 'twins', 'triplets', 'quadruplets'][n]}!")
        for s in sibs:
            born = START_YEAR - s.age
            s.add_log(f"🍼 You were born in {born} in {f.place}! Your parents are {f.mom['first']} and {f.dad['first']} {f.last}.")
            self.flog(f"🍼 {s.first} {f.last} was born in {born}.")
            older_by = [o for o in sibs if o.age > s.age]
            for o in older_by:
                if o.age - s.age > 0:
                    o.add_log(f"👶 Your little {'brother' if s.gender == 'm' else 'sister'} {s.first} was born!")
        for s in sibs:
            twins = [o for o in sibs if o is not s and o.age == s.age]
            if twins:
                s.add_log(f"👯 You have a twin: {join_names(o.first for o in twins)}!")
        for s in sibs:
            s.q = 1
        self.phase = "playing"
        self.begin_turn()

    # ------------------------------------------------------------------ actions
    def do_action(self, m, s, msg):
        spec = D["action_map"].get(msg.get("a"))
        if not spec or spec.get("client"):
            return
        env = self.env(s)
        if not check(spec.get("cond"), env):
            m.send("g:toast", text="You can't do that right now. 🤔", delta=[], warn=True)
            return
        if s.energy <= 0:
            m.send("g:toast", text="😴 You're out of energy this year! Start an Age vote when you're done.", delta=[], warn=True)
            return
        key = spec["id"] if spec["id"] != "apply" else f"apply:{msg.get('job')}"
        if key in s.done:
            m.send("g:toast", text="You already did that this year. Try something else! 🔁", delta=[], warn=True)
            return
        lets = {}
        for k, expr in (spec.get("let") or {}).items():
            env[k] = lets[k] = num(expr, env)
        before = s.snap()
        if spec.get("handler") == "apply":
            text, used = self.apply_job(s, msg)
        else:
            out = pick_weighted(spec.get("outcomes", []), env)
            if not out:
                return
            extra = self.apply_fx(s, out.get("fx", {}), None, env, scale=0.6 if self.quarterly else 1.0)
            ctx = self.ctx(s)
            ctx.update({k: (str(v) if k in PLAIN_LETS else money_str(v)) for k, v in lets.items()})
            text, used = " ".join([fmt(out.get("text", ""), ctx)] + extra), True
        if text is None:
            return
        if used:
            s.energy -= 1
            s.done.add(key)
            s.add_log(text)
        m.send("g:toast", text=text, delta=s.diff(before), warn=not used)
        self.after_change()

    def job_check(self, s, key):
        j = D["jobs"][key]
        if s.job and s.job["key"] == key:
            return False, "You already work here"
        if s.age < j["age"]:
            return False, f"Must be {j['age']}+"
        if (s.age < 18 or s.uni) and not j.get("part"):
            return False, "Finish school first"
        edu = j.get("edu")
        if edu == "degree" and not s.degrees:
            return False, "Needs a university degree"
        if edu and edu != "degree":
            majors = edu.split("|")
            if not any(d in majors for d in s.degrees):
                return False, "Needs a " + " or ".join(D["majors"][x][0] for x in majors if x in D["majors"]) + " degree"
        for stat in ("smarts", "health", "looks", "music", "sport"):
            need = j.get(stat)
            if need and getattr(s, stat) < need:
                return False, f"Needs {engine.ICON[stat]} {need}+"
        return True, ""

    def apply_job(self, s, msg):
        key = msg.get("job")
        if key not in D["jobs"]:
            return None, False
        ok, why = self.job_check(s, key)
        if not ok:
            return f"You can't apply for that yet: {why}", False
        j = D["jobs"][key]
        odds = max(0.08, min(0.97, j["chance"] + (s.smarts - 50) / 400 + (s.looks - 50) / 500 + (s.karma - 50) / 1000))
        if random.random() < odds:
            had = s.job
            s.job = {"key": key, "title": j["title"], "emoji": j["emoji"], "salary": j["salary"], "level": 0, "perf": 30, "years": 0}
            if j["prestige"] > s.peak_prestige:
                s.peak_prestige, s.best_job = j["prestige"], j["title"]
            s.add("happy", random.randint(5, 9))
            if j["prestige"] >= 30:
                self.flog(f"{j['emoji']} {s.first} became a {j['title']}!")
            if key == "astronaut":
                s.achieve("🚀 Went to space")
            return f"{'You switched jobs! ' if had else ''}You got hired as a {j['title']}! {j['emoji']} ({money_str(j['salary'])}/yr)", True
        s.add("happy", -random.randint(2, 4))
        return f"The {j['title']} job went to someone else. Keep trying! 📭", True

    # ------------------------------------------------------------------ sibling actions
    def sib_available(self, s, t):
        out = []
        if not (s.alive and t.alive) or s is t:
            return out
        e = self.sib_env(s, t)
        for a in D["sib_actions"]:
            if e["silent"] and not a.get("works_when_silent"):
                continue
            if f"{a['id']}:{t.cid}" in s.done:
                continue
            if any(r["from"] == s.cid and r["to"] == t.cid for r in self.requests.values()):
                if a.get("consent"):
                    continue
            if check(a.get("cond"), e) and check(a.get("target_cond"), e):
                out.append(a["id"])
        return out

    def do_sib_action(self, m, s, msg):
        spec = D["sib_map"].get(msg.get("a"))
        t = self.sibs.get(msg.get("target"))
        if not spec or not t or t is s or not t.alive:
            return
        if s.energy <= 0:
            m.send("g:toast", text="😴 You're out of energy this year!", delta=[], warn=True)
            return
        if spec["id"] not in self.sib_available(s, t):
            p = self.pair(s, t)
            why = f"You and {t.first} aren't speaking right now. 🙊" if p["silent"] else "You can't do that right now. 🤔"
            m.send("g:toast", text=why, delta=[], warn=True)
            return
        e = self.sib_env(s, t)
        amount = 0
        if spec.get("amount") == "choose":
            amount = int(clean_num(msg.get("amount"), 0, 0, 10 ** 9))
            if amount < 1 or amount > t.money:
                m.send("g:toast", text=f"{t.first} doesn't have that much money. 💸", delta=[], warn=True)
                return
        elif spec.get("amount"):
            amount = max(0, num(spec["amount"], e))
        picks = {k: random.choice(v) for k, v in (spec.get("pick") or {}).items()}
        s.energy -= 1
        s.done.add(f"{spec['id']}:{t.cid}")
        if spec.get("consent"):
            self.req_seq += 1
            rid = self.req_seq
            text = fmt(spec.get("ask", "{self} asked you something."), {"self": s.first, "amount": money_str(amount), **picks})
            self.requests[rid] = {"id": rid, "kind": spec["id"], "from": s.cid, "to": t.cid, "amount": amount,
                                  "picks": picks, "text": text, "emoji": spec.get("emoji", "📨"),
                                  "timer": self.room.later(REQUEST_TTL, self.expire_request, rid)}
            m.send("g:toast", text=f"📨 You asked {t.first}… waiting for their answer.", delta=[])
            tm = self.member_of(t)
            if tm:
                tm.send("g:request", text=text)
        else:
            result = pick_weighted(spec.get("outcomes", []), e)
            if result:
                self.apply_sib_result(spec, result, s, t, amount, picks)
        self.after_change()

    def apply_sib_result(self, spec, r, s, t, amount, picks):
        ctx = {"self": s.first, "target": t.first, "amount": money_str(amount), **picks}
        bs, bt = s.snap(), t.snap()
        moved = 0
        tr = r.get("transfer")
        if tr == "self_to_target":
            moved = max(0, min(amount, s.money))
            s.money -= moved
            t.money += moved
        elif tr == "target_to_self":
            moved = max(0, min(amount, t.money))
            t.money -= moved
            s.money += moved
        ctx["amount"] = money_str(moved or amount)
        if r.get("debt") and moved:
            self.debts[(s.cid, t.cid)] = self.debts.get((s.cid, t.cid), 0) + moved
        if r.get("clear_debt"):
            self.debts.pop((s.cid, t.cid), None)
        env_s = self.sib_env(s, t)
        env_s["amount"] = amount
        env_t = self.sib_env(t, s)
        env_t["amount"] = amount
        self.apply_fx(s, r.get("self"), t, env_s)
        self.apply_fx(t, r.get("target"), s, env_t)
        if "rel" in r:
            self.bond(s, t, num(r["rel"], env_s))
        if r.get("count"):
            s.counters[r["count"]] = s.counters.get(r["count"], 0) + 1
        if r.get("chaos"):
            s.counters["chaos"] += int(r["chaos"])
        st, tt = fmt(r.get("self_text"), ctx), fmt(r.get("target_text"), ctx)
        if st:
            s.add_log(st)
            self.toast(s, st, s.diff(bs))
        if tt:
            t.add_log(tt)
            m = self.member_of(t)
            if m:
                m.send("g:notify", text=tt, delta=t.diff(bt))
        if r.get("log"):
            self.flog(fmt(r["log"], ctx))
        p = self.pair(s, t)
        if p["silent"] and spec["id"] == "gift" and random.random() < 0.35:
            p["silent"] = False
            p["rel"] = max(p["rel"], 40)
            self.flog(f"🕊️ {s.first}'s gift worked — {s.first} and {t.first} are talking again!")

    def respond(self, m, s, msg):
        req = self.requests.get(msg.get("rid"))
        if not req or req["to"] != s.cid:
            return
        self.requests.pop(req["id"], None)
        self.room.cancel(req["timer"])
        spec = D["sib_map"][req["kind"]]
        frm = self.sibs.get(req["from"])
        if not frm or not frm.alive:
            self.after_change()
            return
        accept = bool(msg.get("accept"))
        if accept and req["kind"] == "borrow" and s.money < req["amount"]:
            accept = False
            m.send("g:toast", text="You don't have enough money to lend that. 💸", delta=[], warn=True)
        self.apply_sib_result(spec, spec["accept" if accept else "decline"], frm, s, req["amount"], req["picks"])
        self.after_change()

    def expire_request(self, rid, push=True):
        req = self.requests.pop(rid, None)
        if not req:
            return
        self.room.cancel(req["timer"])
        spec = D["sib_map"][req["kind"]]
        frm, to = self.sibs.get(req["from"]), self.sibs.get(req["to"])
        if frm and to and frm.alive and to.alive:
            self.toast(frm, f"⌛ {to.first} didn't answer in time.", warn=True)
            r = dict(spec.get("decline", {}))
            r.pop("target_text", None)
            r["self_text"] = None
            self.apply_sib_result(spec, r, frm, to, req["amount"], req["picks"])
        if push:
            self.push()

    # ------------------------------------------------------------------ votes
    def group_check(self, spec, s):
        if not check(spec.get("cond"), self.fenv()):
            return False, "Not possible right now.", []
        last = self.family.cooldowns.get(spec["id"])
        cd = spec.get("cooldown", 0) * 4
        if last is not None and cd and self.t - last < cd:
            left = cd - (self.t - last)
            return False, f"Done recently — wait {jail_str(left)}.", []
        involved = [x for x in self.alive() if check(spec.get("who"), self.env(x))]
        if s not in involved:
            return False, "You can't join this one.", involved
        if len(involved) < spec.get("min", 1):
            return False, f"Needs {spec.get('min', 1)}+ siblings who can join.", involved
        return True, "", involved

    def vote_start(self, m, s, msg):
        if self.vote:
            m.send("g:toast", text="🗳️ A vote is already happening — finish that one first!", delta=[], warn=True)
            return
        now = time.time()
        if self.cooldown.get(s.cid, 0) > now:
            m.send("g:toast", text="⏳ Give it a few seconds before starting another vote.", delta=[], warn=True)
            return
        kind = msg.get("kind")
        if kind == "age":
            voters = self.alive()
            if self.quarterly:
                nq, ny = (1, self.year + 1) if self.q == 4 else (self.q + 1, self.year)
                title = f"⏩ On to {self.when(ny, nq)}?"
                desc = ("🎆 It's New Year — everyone gets a year older!" if nq == 1 else "Time moves forward one season.") + \
                    " Done with your actions?"
            else:
                title, desc = f"⏩ Age up to {self.year + 1}?", "Everyone ages one year at the same time. Done with your actions?"
            possible, rule, action, need = [], "unanimous", None, 1
        elif kind == "group":
            spec = D["group_map"].get(msg.get("action"))
            if not spec:
                return
            ok, why, voters = self.group_check(spec, s)
            if not ok:
                m.send("g:toast", text=why, delta=[], warn=True)
                return
            c = self.fctx(voters)
            title, desc = f"{spec['emoji']} {spec['title']}", fmt(spec.get("description", ""), c)
            possible = [fmt(p, c) for p in spec.get("possible", [])]
            rule, action = self.settings["rules"].get(spec["id"], spec.get("rule", "majority")), spec["id"]
            need = spec.get("min", 1)
        else:
            return
        votes, listed = {s.cid: "yes"}, []
        for v in voters:
            if v is not s and not self.online(v):
                if self.settings["offline"] == "skip":
                    continue
                votes[v.cid] = "abstain"
            listed.append(v.cid)
        self.vote_seq += 1
        self.vote = {"id": self.vote_seq, "kind": kind, "action": action, "title": title, "desc": desc,
                     "possible": possible, "rule": rule, "need": need, "starter": s.cid, "voters": listed, "votes": votes,
                     "deadline": now + self.settings["voteTimeout"]}
        self.vote_timer = self.room.later(self.settings["voteTimeout"], self.vote_timeout, self.vote_seq)
        if not self.tally():
            self.push()

    def cast_vote(self, s, msg):
        v = self.vote
        if not v or msg.get("id") != v["id"] or s.cid not in v["voters"] or s.cid in v["votes"]:
            return
        v["votes"][s.cid] = "yes" if msg.get("yes") else "no"
        if not self.tally():
            self.push()

    def vote_timeout(self, vid):
        if self.vote and self.vote["id"] == vid:
            self.tally(final=True)

    def tally(self, final=False):
        """Returns True if the vote finished (and the state was pushed)."""
        v = self.vote
        if not v:
            return False
        total = len(v["voters"])
        yes = sum(1 for c in v["voters"] if v["votes"].get(c) == "yes")
        no = sum(1 for c in v["voters"] if v["votes"].get(c) == "no")
        abstain = sum(1 for c in v["voters"] if v["votes"].get(c) == "abstain")
        pending = total - yes - no - abstain
        res = None
        if v["rule"] == "optin":
            need = v.get("need", 1)
            if yes + pending < need:
                res = False
            elif pending == 0 or final:
                res = yes >= need
        elif v["rule"] == "unanimous":
            if no:
                res = False
            elif pending == 0:
                res = yes > 0
            elif final:
                res = False
        else:
            if yes * 2 > total:
                res = True
            elif (yes + pending) * 2 <= total:
                res = False
            elif final:
                res = False
        if res is None:
            return False
        self.finish_vote(res)
        return True

    def finish_vote(self, passed):
        v = self.vote
        self.vote = None
        self.room.cancel(self.vote_timer)
        starter = self.sibs.get(v["starter"])
        if passed:
            self.broadcast("vote_result", id=v["id"], passed=True, title=v["title"])
            if v["kind"] == "age":
                self.end_turn()
            else:
                crew = [self.sibs[c] for c in v["voters"] if self.sibs[c].alive and (v["rule"] != "optin" or v["votes"].get(c) == "yes")]
                self.run_group(D["group_map"][v["action"]], crew, v["starter"])
            self.push()
            return
        no_names = [self.sibs[c].first for c in v["voters"] if v["votes"].get(c) == "no"]
        pending = [self.sibs[c].first for c in v["voters"] if c not in v["votes"]]
        if v["rule"] == "optin":
            yes_n = sum(1 for c in v["voters"] if v["votes"].get(c) == "yes")
            reason = f"🙅 Only {yes_n} joined — needed {v.get('need', 1)}."
        elif no_names:
            reason = f"❌ {join_names(no_names)} voted no."
        else:
            reason = "⏰ Time ran out" + (f" — {join_names(pending)} didn't vote." if pending else ".")
        self.broadcast("vote_result", id=v["id"], passed=False, title=v["title"], reason=reason)
        if starter:
            self.toast(starter, f"Your vote “{v['title']}” was cancelled. {reason}", warn=True)
            self.cooldown[starter.cid] = time.time() + 4
        if v["kind"] == "group":
            spec = D["group_map"][v["action"]]
            self.flog(f"🗳️ {fmt(spec.get('fail', 'The vote failed.'), self.fctx())} ({reason})")
            if spec.get("handler") == "inheritance":
                self.rel_all(self.alive(), -4)
        self.push()

    def run_group(self, spec, involved, starter=None):
        self.family.cooldowns[spec["id"]] = self.t
        c = self.fctx(involved)
        handler = spec.get("handler")
        if handler == "heist":
            text = self.g_heist(spec, involved, c, starter)
        elif handler == "business":
            text = self.g_business(involved, c)
        elif handler == "care_home":
            text = self.g_care_home(involved, c)
        elif handler == "inheritance":
            text = self.g_inheritance(c)
        else:
            out = pick_weighted(spec.get("outcomes", []), self.fenv()) or {}
            if out.get("family"):
                self.family_fx(out["family"], c)
            for s in involved:
                self.apply_fx(s, out.get("each"), None, self.env(s))
                if "rel_parents" in out:
                    d = num(out["rel_parents"], {})
                    s.rel_mom, s.rel_dad = clamp(s.rel_mom + d), clamp(s.rel_dad + d)
            if "sib_rel_all" in out:
                self.rel_all(involved, out["sib_rel_all"])
            text = fmt(out.get("text", "Something happened."), c)
        self.flog(text)
        for s in involved:
            s.add_log(text)
        self.announce(text)

    def g_heist(self, spec, crew, c, starter_cid):
        h = spec.get("heist", {})
        name = h.get("name", "target")
        crew = list(crew)
        if not crew:
            return f"🦹 Nobody showed up for the {name} heist."
        roles, pool = {}, list(crew)
        starter = self.sibs.get(starter_cid)
        if starter in pool:
            roles[starter.cid] = HEIST_ROLES[0]
            pool.remove(starter)
        for role in HEIST_ROLES[1 if roles else 0:]:
            if not pool:
                break
            best = max(pool, key=lambda x: getattr(x, role[1]))
            roles[best.cid] = role
            pool.remove(best)
        role_line = ", ".join(f"{roles[x.cid][0]} {x.first}" for x in crew)
        skill = sum(getattr(x, roles[x.cid][1]) for x in crew) / len(crew)
        heat = sum(x.heat for x in crew) / len(crew)
        pairs = [(a, b) for i, a in enumerate(crew) for b in crew[i + 1:]]
        trust = sum(self.rel(a, b) for a, b in pairs) / len(pairs) if pairs else 60
        odds = 0.3 + (skill - h.get("difficulty", 50)) / 100 + 0.06 * (len(crew) - 1) - heat / 250 + (trust - 50) / 400
        odds = max(0.08, min(0.9, odds))
        lo, hi = h.get("loot", [10000, 50000])
        for x in crew:
            x.counters["crimes"] = x.counters.get("crimes", 0) + 1
            x.counters["chaos"] += 3
            x.add("karma", -12)
            x.add("heat", h.get("heat", 30))
        roll = random.random()
        names = join_names(x.first for x in crew)
        if roll < odds:
            loot = random.randint(lo, hi)
            share = loot // len(crew)
            for x in crew:
                x.money += share
                x.add("fame", h.get("fame", 5))
                x.add("happy", 10)
                x.achieve("🦹 Heist crew")
                if loot >= 1_000_000:
                    x.achieve("💎 The Big Score")
            self.rel_all(crew, 8)
            return f"💰 HEIST SUCCESS! {names} hit the {name} and got away with {money_str(loot)} — {money_str(share)} each! ({role_line})"
        if roll < odds + 0.15:
            loot = random.randint(lo, hi) // 3
            share = loot // len(crew)
            hurt = random.choice(crew)
            for x in crew:
                x.money += share
                x.add("heat", 15)
            hurt.add("health", -15)
            return (f"😬 The {name} heist got messy. {names} escaped with only {money_str(loot)} ({money_str(share)} each), "
                    f"and {hurt.first} got hurt on the way out. ({role_line})")
        years = random.randint(*h.get("jail", [1, 3]))
        snitch = None
        if len(crew) > 1 and trust < 45 and random.random() < 0.6:
            snitch = min(crew, key=lambda x: sum(self.rel(x, o) for o in crew if o is not x))
        for x in crew:
            self.send_to_jail(x, 1 if x is snitch else years)
            x.add("happy", -10)
        if snitch:
            for o in crew:
                if o is not snitch:
                    self.bond(snitch, o, -40)
        text = f"🚔 BUSTED! The {name} heist went wrong — {names} got {years} year{'s' if years != 1 else ''} in jail."
        if snitch:
            text += f" 🐀 {snitch.first} snitched on the crew and only got 1 year!"
        return text + f" ({role_line})"

    def g_business(self, involved, c):
        stakes = {s.cid: max(0, int(s.money * 0.25)) for s in involved}
        pot = sum(stakes.values())
        name = fmt(random.choice(BUSINESSES), c)
        if pot < 1000:
            return f"🏢 {c['names']} tried to start “{name}” but nobody had any money. 🪙"
        avg_smarts = sum(s.smarts for s in involved) / len(involved)
        if random.random() < 0.3 + avg_smarts / 250:
            mult = random.uniform(1.6, 4.0)
            for s in involved:
                gain = int(stakes[s.cid] * (mult - 1))
                s.money += gain
                s.add("happy", 10)
                s.achieve("🏢 Entrepreneur")
            self.rel_all(involved, 8)
            return f"🚀 {c['names']} started “{name}” — it was a HIT! Everyone got back {mult:.1f}× their money."
        for s in involved:
            s.money -= stakes[s.cid]
            s.add("happy", -8)
        self.rel_all(involved, -6)
        return f"📉 “{name}” by {c['names']} went bankrupt. Everyone lost their {money_str(pot // len(involved))}-ish investment."

    def g_care_home(self, involved, c):
        p = self.old_parent()
        if not p:
            return "🏠 Turns out nobody needs a care home right now."
        p["care"] = True
        p["health"] = clamp(p["health"] + 12)
        for s in involved:
            s.money -= 3000
            s.add("karma", -1)
            if p is self.family.mom:
                s.rel_mom = clamp(s.rel_mom - 8)
            else:
                s.rel_dad = clamp(s.rel_dad - 8)
        return f"🏥 {c['names']} moved {p['first']} into a care home. Great care — and lots of bingo. 🎱"

    def g_inheritance(self, c):
        f = self.family
        al = self.alive()
        if f.inheritance <= 0 or not al:
            return "📜 There was no inheritance left to split."
        share = f.inheritance // len(al)
        for s in al:
            s.money += share
            s.add("happy", 5)
        total = f.inheritance
        f.inheritance = 0
        return f"📜 The inheritance of {money_str(total)} was split equally — {money_str(share)} each! 💰"

    # ------------------------------------------------------------------ years
    def begin_turn(self):
        for s in self.alive():
            s.energy = (2 if self.quarterly else 3) if s.age >= 5 else 2
            s.done = set()
            if not s.event:
                s.event = self.pick_event(s)
        self.broadcast("year", year=self.year, q=self.q)
        self.push()

    def end_turn(self):
        for rid in list(self.requests):
            self.expire_request(rid, push=False)
        for s in list(self.alive()):
            if s.event:
                self.resolve_event(s, random.randrange(len(s.event["choices"])))
        for _ in range(1 if self.quarterly else 4):
            self.next_quarter()
            if self.check_over():
                return
        self.family_event()
        self.begin_turn()

    def next_quarter(self):
        self.t += 1
        self.q += 1
        new_year = self.q > 4
        if new_year:
            self.q = 1
            self.year += 1
        for s in list(self.alive()):
            s.q = self.q
            self.quarter_up(s)
            if new_year and s.alive:
                self.age_up(s)
        if new_year and self.alive():
            self.parents_age()
            self.family_year()
            self.pair_year()

    def quarter_up(self, s):
        """Things that happen every season: pay, rent, jail time, heat cooling down."""
        a = s.age
        if s.job and s.jail == 0:
            s.money += int(s.job["salary"] * 0.75 / 4)
        if a >= 18 and s.jail == 0:
            rent = {"home": 3000, "own": 14000, "together": 8000}.get(s.living, 8000)
            s.money -= (rent + 3000 * len([k for k in s.kids if a - k["born"] < 18])) // 4
        if s.retired:
            s.money += s.pension // 4
        if s.heat:
            s.add("heat", -3)
        if s.jail > 0:
            s.jail -= 1
            s.add("happy", -1)
            if s.jail == 0:
                s.add_log("🔓 You were released from jail! Freedom!")
                self.flog(f"🔓 {s.first} was released from jail.")
        if random.random() < (0.08 if self.quarterly else 0):
            self.happening(s)

    def happening(self, s):
        pool = [x for x in D["happenings"] if x["ages"][0] <= s.age <= x["ages"][1]]
        if pool:
            h = random.choices(pool, weights=[x.get("weight", 1) for x in pool])[0]
            self.apply_fx(s, h.get("fx"))
            s.add_log(h["text"])

    def age_up(self, s):
        s.age += 1
        s.years += 1
        s.happy_sum += s.happy
        a = s.age
        if a == 5:
            s.add_log("🏫 You started elementary school!")
        elif a == 14:
            s.add_log("🎒 You started high school!")

        if s.uni:
            s.uni["years"] += 1
            s.money -= 12000
            s.add("smarts", random.randint(1, 3))
            if s.uni["years"] >= 4:
                major = s.uni["major"]
                s.degrees.append(major)
                s.uni = None
                s.achieve("🎓 University graduate")
                s.add_log(f"🎓 You graduated with a degree in {D['majors'][major][0]}!")
                self.flog(f"🎓 {s.first} graduated with a {D['majors'][major][0]} degree!")
                s.add("happy", random.randint(8, 12))

        if s.job and s.jail == 0:
            spec = D["jobs"].get(s.job["key"], {})
            s.job["years"] += 1
            s.job["perf"] += random.randint(-4, 9) + (s.smarts - 50) // 25
            if spec.get("star"):
                s.fame = clamp(s.fame + random.randint(-1, 5))
                s.job["salary"] = int(spec["salary"] * (1 + s.fame / spec["star"]))
                if s.fame >= 80 and s.achieve("⭐ Famous"):
                    self.flog(f"⭐ {s.first} is now world-famous!")
            elif s.job["perf"] >= 100 and s.job["level"] < len(LEVELS) - 1:
                s.job["level"] += 1
                s.job["perf"] = 25
                s.job["salary"] = int(s.job["salary"] * 1.3)
                s.job["title"] = LEVELS[s.job["level"]] + spec.get("title", s.job["title"])
                if spec.get("prestige", 0) + s.job["level"] * 4 > s.peak_prestige:
                    s.peak_prestige, s.best_job = spec.get("prestige", 0) + s.job["level"] * 4, s.job["title"]
                s.add("happy", random.randint(5, 8))
                s.add_log(f"🎉 PROMOTED to {s.job['title']}! New salary: {money_str(s.job['salary'])}")
                if s.job["level"] >= 3:
                    self.flog(f"📈 {s.first} was promoted to {s.job['title']}!")
            if s.job["perf"] < -10 and random.random() < 0.5:
                s.add_log(f"😱 You were FIRED from your job as a {s.job['title']}.")
                self.flog(f"🔥 {s.first} got fired!")
                s.job = None
                s.add("happy", -random.randint(8, 12))
            else:
                s.job["perf"] -= 5

        if s.money < 0:
            s.money = int(s.money * 1.05)
            s.add("happy", -random.randint(1, 3))
        for asset in s.assets:
            asset["value"] = int(asset["value"] * (0.9 if asset["kind"] == "car" else 1.03))

        if s.partner:
            s.partner["years"] = s.partner.get("years", 0) + 1
            if not s.partner["married"] and random.random() < 0.08:
                s.add_log(f"💔 {s.partner['name']} broke up with you.")
                s.partner = None
                s.add("happy", -random.randint(5, 10))
            elif a > 60 and random.random() < 0.02 * (a - 60) / 10:
                s.add_log(f"🕊️ Your spouse {s.partner['name']} passed away.")
                s.partner = None
                s.add("happy", -random.randint(12, 20))
        for pet in list(s.pets):
            if a - pet["born"] > random.randint(10, 18):
                s.pets.remove(pet)
                s.add_log(f"🌈 Your {pet['kind']} {pet['name']} crossed the rainbow bridge.")
                s.add("happy", -random.randint(4, 8))

        if 13 <= a <= 17 and s.living == "home":
            s.rel_mom, s.rel_dad = clamp(s.rel_mom - random.randint(0, 3)), clamp(s.rel_dad - random.randint(0, 3))
        if a > 50:
            s.add("health", -(random.randint(0, 2) + (a - 50) // 12))
        if a > 35 and random.random() < 0.3:
            s.add("looks", -1)
        if s.happy < 50:
            s.add("happy", random.randint(0, 2))
        elif s.happy > 60:
            s.add("happy", -random.randint(0, 2))
        if not (s.job and D["jobs"].get(s.job["key"], {}).get("star")) and s.fame > 0:
            s.fame -= 1

        if not self.quarterly and random.random() < 0.3:
            self.happening(s)
        s.add_log(f"🎂 Happy birthday! You're {a} now.")

        if s.worth() >= 1_000_000 and s.achieve("💰 Millionaire"):
            self.flog(f"💰 {s.first} became a MILLIONAIRE!")
        if a == 100 and s.achieve("💯 Centenarian"):
            self.flog(f"💯 {s.first} turned 100!")
        cause = self.death_roll(s.age, s.health)
        if cause:
            self.kill(s, cause)

    def death_roll(self, age, health, adult_only=True):
        names = D["names"]
        if health <= 0:
            return random.choice(names["death_sick"])
        if age >= 120:
            return "extreme old age 🧓"
        if adult_only and age < 18:
            return None
        if age < 45:
            base = 0.0008
        elif age < 70:
            base = 0.002 + (age - 45) * 0.0015
        else:
            base = 0.04 + (age - 70) * 0.012
        if health < 25:
            base = base * 3 + 0.05
        elif health < 45:
            base *= 1.8
        if random.random() < base:
            return random.choice(names["death_sick"] if health < 35 or age < 60 else names["death_old"])
        if random.random() < 0.0005:
            return random.choice(names["death_weird"])
        return None

    def parents_age(self):
        for p in (self.family.mom, self.family.dad):
            if not p["alive"]:
                continue
            p["age"] += 1
            if p["age"] > 55:
                p["health"] = clamp(p["health"] - random.randint(0, 2) - (p["age"] - 55) // 12)
            if p["care"]:
                p["health"] = clamp(p["health"] + 3)
            cause = self.death_roll(p["age"], p["health"])
            if cause:
                self.parent_dies(p, cause)

    def parent_dies(self, p, cause):
        f = self.family
        p["alive"] = False
        share = f.money if not f.parents() else f.money // 2
        f.money -= share
        if share > 0:
            f.inheritance += share
            f.inheritance_year = self.year
        text = f"🕊️ {p['role']} ({p['first']}) passed away at {p['age']} from {cause}."
        if share > 0:
            text += f" They left {money_str(share)} to the kids — vote to split it!"
        self.flog(text)
        self.announce(text)
        for s in self.alive():
            s.add("happy", -random.randint(8, 15))
            s.add_log(text)

    def family_year(self):
        f = self.family
        al = self.alive()
        working = [p for p in f.parents() if p["age"] < 65]
        minors_home = sum(1 for s in al if s.age < 18 and s.living == "home")
        f.money = max(0, f.money + int(sum(p["salary"] for p in working) * 0.12) - 2500 * minors_home)
        if f.inheritance > 0 and f.inheritance_year is not None and self.year - f.inheritance_year >= 3 and al:
            after_lawyers = int(f.inheritance * 0.7)
            share = after_lawyers // len(al)
            for s in al:
                s.money += share
            self.flog(f"⚖️ Nobody could agree, so the lawyers split the inheritance — and kept 30%. Everyone got {money_str(share)}.")
            f.inheritance = 0

    def family_event(self):
        chance = D["family_chance"] * (0.4 if self.quarterly else 1)
        if random.random() > chance:
            return
        fe = self.fenv()
        pool = [e for e in D["family_events"]
                if not (e.get("once") and e["id"] in self.family.seen)
                and self.t - self.family.seen.get(e["id"], -999) >= 4 * e.get("every", 4) and check(e.get("cond"), fe)
                and not (e.get("seasons") and self.quarterly and self.q not in e["seasons"])]
        if not pool:
            return
        ev = random.choices(pool, weights=[e.get("weight", 1) for e in pool])[0]
        self.family.seen[ev["id"]] = self.t
        c = self.fctx()
        text_ctx_pet = dict(c)
        if ev.get("family"):
            self.family_fx(ev["family"], c)
        if ev.get("family", {}).get("pet_die"):
            c.update({k: text_ctx_pet[k] for k in ("petname", "petkind", "petemoji")})
        text = fmt(ev["text"], c)
        for s in self.alive():
            if check(ev.get("each_cond"), self.env(s)):
                self.apply_fx(s, ev.get("each"))
            s.add_log(f"🏡 {text}")
        if "sib_rel_all" in ev:
            self.rel_all(self.alive(), ev["sib_rel_all"])
        self.flog(text)
        self.announce(text)

    def pair_year(self):
        al = self.alive()
        for i, a in enumerate(al):
            for b in al[i + 1:]:
                p = self.pair(a, b)
                close = (a.living == b.living and a.living in ("home", "together"))
                if not p["silent"]:
                    if random.random() < 0.5:
                        self.bond(a, b, 1 if close else (0 if p["best"] else -1))
                elif self.year - (p["since"] or self.year) >= 2 and random.random() < 0.25:
                    who, other = random.choice([(a, b), (b, a)])
                    if not who.event:
                        who.event = self.make_event(D["events_by_id"]["make_up"], who, forced=True, sib=other)

    def kill(self, s, cause):
        if not s.alive:
            return
        s.alive = False
        s.cause = cause
        s.event = None
        s.add_log(f"🪦 You died at age {s.age} from {cause}.")
        s.score = self.score(s)
        self.flog(f"🪦 {self.full(s)} died at {s.age} from {cause}. Life score: {s.score['total']}")
        for rid, r in list(self.requests.items()):
            if s.cid in (r["from"], r["to"]):
                self.room.cancel(r["timer"])
                self.requests.pop(rid, None)
        for o in self.alive():
            o.add("happy", -random.randint(6, 12))
            o.add_log(f"🕊️ Your sibling {s.first} died at {s.age}.")
        m = self.member_of(s)
        if m:
            m.send("g:died", age=s.age, cause=cause, score=s.score)
        if self.vote and s.cid in self.vote["voters"]:
            self.vote["voters"].remove(s.cid)
            self.vote["votes"].pop(s.cid, None)
            if self.vote["voters"]:
                self.tally()
            else:
                self.vote = None
                self.room.cancel(self.vote_timer)

    def after_change(self):
        if not self.check_over():
            self.push()

    def check_over(self):
        if self.phase == "playing" and self.sibs and not self.alive():
            self.finish()
            return True
        return False

    # ------------------------------------------------------------------ endgame
    def score(self, s):
        years = max(1, s.years)
        others = [o for o in self.sibs.values() if o is not s]
        sib_love = int(sum(self.rel(s, o) for o in others) / len(others) / 4) if others else 0
        parts = [
            ("🎂 Years lived", s.age),
            ("😊 Happiness", int(s.happy_sum / years / 2)),
            ("💰 Net worth", clamp(s.worth() // 25000, -50, 200)),
            ("🎓 Education", 20 * len(s.degrees)),
            ("💼 Career", s.peak_prestige),
            ("💞 Love & family", (15 if s.ever_married else 0) + min(20, 5 * len(s.kids))),
            ("👫 Sibling bond", sib_love),
            ("⭐ Fame", s.fame // 2),
            ("🏆 Achievements", 5 * len(s.achievements)),
            ("😇 Karma", (s.karma - 50) // 5),
            ("🚔 Jail time", -3 * s.jail_total),
        ]
        parts = [{"label": k, "pts": int(v)} for k, v in parts if v]
        return {"total": sum(x["pts"] for x in parts), "parts": parts}

    def chaos(self, s):
        c = s.counters
        return c.get("chaos", 0) + 2 * c.get("crimes", 0) + 2 * s.jail_total + c.get("pranks", 0) + c.get("arguments", 0)

    def sibling_love(self, s):
        others = [o for o in self.sibs.values() if o is not s]
        if not others:
            return 0
        avg = sum(self.rel(s, o) for o in others) / len(others)
        return int(avg + 3 * s.counters.get("gifts", 0) + 2 * s.counters.get("hangouts", 0))

    def finish(self):
        self.room.cancel(self.vote_timer)
        self.vote = None
        self.phase = "over"
        sibs = list(self.sibs.values())
        for s in sibs:
            if s.score is None:
                s.score = self.score(s)
        awards = []

        def award(title, emoji, value, show, ok=lambda v: True):
            best = max(sibs, key=value)
            v = value(best)
            if ok(v):
                awards.append({"title": title, "emoji": emoji, "cid": best.cid, "name": best.first, "value": show(v)})

        award("Richest", "💰", lambda s: s.worth(), money_str)
        award("Most Chaotic", "🌪️", self.chaos, lambda v: f"{v} chaos points", lambda v: v > 0)
        if len(sibs) > 1:
            award("Best Sibling", "💞", self.sibling_love, lambda v: f"{v} sibling love")
        award("Longest Life", "🧓", lambda s: s.age, lambda v: f"{v} years")
        award("Biggest Brain", "🧠", lambda s: s.smarts, lambda v: f"{v} smarts")
        award("Most Famous", "⭐", lambda s: s.fame, lambda v: f"{v} fame", lambda v: v > 0)
        award("Happiest", "😊", lambda s: int(s.happy_sum / max(1, s.years)), lambda v: f"{v} avg happiness")
        ranking = []
        for s in sorted(sibs, key=lambda x: -x.score["total"]):
            m = self.member_of(s)
            ranking.append({"cid": s.cid, "name": self.full(s), "first": s.first, "player": m.name if m else s.player,
                            "avatar": m.avatar if m else s.avatar, "color": m.color if m else s.color,
                            "age": s.age, "cause": s.cause, "score": s.score, "worth": s.worth(),
                            "stats": {k: getattr(s, k) for k in STATS}, "fame": s.fame,
                            "achievements": s.achievements, "summary": self.summary(s), "story": s.log[-80:]})
        self.ranking = ranking
        self.awards = awards
        for c in self.chars.values():
            c["ready"] = False
        self.family_final = self.family.public()
        self.family_log_final = self.family.log[-150:]
        self.family = Family(D["names"])
        self.broadcast("over")
        self.push()

    def summary(self, s):
        bits = []
        if s.degrees:
            bits.append("studied " + ", ".join(D["majors"][d][0] for d in s.degrees))
        if s.best_job:
            bits.append(f"top job: {s.best_job}")
        if s.ever_married:
            bits.append("got married")
        if s.kids:
            bits.append(f"{len(s.kids)} kid{'s' if len(s.kids) != 1 else ''}")
        if s.jail_total:
            bits.append(f"{s.jail_total} yrs in jail")
        bits.append(f"left {money_str(s.worth())}")
        return " · ".join(bits)

    # ------------------------------------------------------------------ state
    def sib_public(self, x, viewer):
        m = self.member_of(x)
        p = {"cid": x.cid, "owner": x.owner, "player": m.name if m else x.player, "avatar": m.avatar if m else x.avatar,
             "color": m.color if m else x.color, "online": self.online(x), "first": x.first, "gender": x.gender,
             "emoji": x.emoji(), "age": x.age, "alive": x.alive, "cause": x.cause, "status": x.status(D["majors"]),
             "stats": {k: getattr(x, k) for k in STATS}, "money": x.money, "worth": x.worth(), "living": x.living,
             "married": bool(x.partner and x.partner["married"]), "jail": x.jail, "heat": x.heat, "me": viewer is x}
        if viewer and viewer is not x:
            pr = self.pair(viewer, x)
            p.update(rel=pr["rel"], best=pr["best"], silent=pr["silent"], twin=viewer.age == x.age,
                     owes=self.debts.get((viewer.cid, x.cid), 0), owed=self.debts.get((x.cid, viewer.cid), 0),
                     acts=self.sib_available(viewer, x) if viewer.alive and self.phase == "playing" else [])
        return p

    def me(self, s):
        actions, jobs, groups = [], [], []
        if s.alive and self.phase == "playing":
            env = self.env(s)
            for a in D["actions"]:
                if a.get("cat") == "hidden" or not check(a.get("cond"), env):
                    continue
                label = a["label"]
                if a["id"] == "propose" and s.partner:
                    label = f"Propose to {s.partner['first']}"
                actions.append({"id": a["id"], "emoji": a["emoji"], "label": label, "cat": a.get("cat", "activities"),
                                "client": a.get("client"), "done": a["id"] in s.done})
            if s.age >= 15 and not s.jail:
                for key, j in D["jobs"].items():
                    ok, why = self.job_check(s, key)
                    jobs.append({"key": key, "title": j["title"], "emoji": j["emoji"], "salary": j["salary"],
                                 "ok": ok, "why": why, "star": bool(j.get("star"))})
            for g in D["group"]:
                ok, why, inv = self.group_check(g, s)
                groups.append({"id": g["id"], "emoji": g["emoji"], "title": g["title"], "ok": ok, "why": why,
                               "rule": self.settings["rules"].get(g["id"], g.get("rule")), "min": g.get("min", 1),
                               "crime": bool(g.get("crime")), "involved": [x.first for x in inv]})
        reqs = [{"id": r["id"], "kind": r["kind"], "emoji": r["emoji"], "text": r["text"], "from": r["from"]}
                for r in self.requests.values() if r["to"] == s.cid]
        outgoing = [{"id": r["id"], "kind": r["kind"], "to": r["to"]} for r in self.requests.values() if r["from"] == s.cid]
        return {
            "cid": s.cid, "name": self.full(s), "first": s.first, "gender": s.gender, "place": self.family.place,
            "emoji": s.emoji(), "age": s.age, "alive": s.alive, "cause": s.cause, "status": s.status(D["majors"]),
            "stats": {k: getattr(s, k) for k in STATS}, "skills": {"music": s.music, "sport": s.sport},
            "fame": s.fame, "heat": s.heat, "money": s.money, "worth": s.worth(), "living": s.living,
            "job": dict(s.job) if s.job else None,
            "uni": {"major": D["majors"][s.uni["major"]][0], "years": s.uni["years"]} if s.uni else None,
            "degrees": [D["majors"][d][0] for d in s.degrees], "jail": s.jail, "retired": s.retired,
            "partner": dict(s.partner) if s.partner else None, "kids": [k["name"] for k in s.kids], "pets": s.pets,
            "assets": s.assets, "achievements": s.achievements, "log": s.log[-140:], "energy": s.energy,
            "maxEnergy": (2 if self.quarterly else 3) if s.age >= 5 else 2, "actions": actions, "jobs": jobs, "groups": groups,
            "event": {"text": s.event["text"], "choices": s.event["labels"]} if s.event else None,
            "requests": reqs, "outgoing": outgoing, "relMom": s.rel_mom, "relDad": s.rel_dad,
            "counters": s.counters, "score": s.score,
        }

    def vote_public(self):
        v = self.vote
        if not v:
            return None
        return {k: v.get(k) for k in ("id", "kind", "action", "title", "desc", "possible", "rule", "need", "starter", "voters", "votes")} | \
            {"remaining": max(0, round(v["deadline"] - time.time(), 1)), "timeout": self.settings["voteTimeout"]}

    def state_for(self, m):
        st = {"phase": self.phase, "settings": self.settings, "chars": self.chars,
              "groupInfo": [{"id": g["id"], "emoji": g["emoji"], "title": g["title"], "crime": bool(g.get("crime"))} for g in D["group"]]}
        if self.phase in ("lobby", "over"):
            st["family"] = self.family.public()
            if self.phase == "over":
                st.update(ranking=self.ranking, awards=self.awards, finalFamily=getattr(self, "family_final", None),
                          familyLog=getattr(self, "family_log_final", []))
            return st
        s = self.sib_of(m.uid) if m else None
        st.update(year=self.year, q=self.q, season=SEASONS[self.q], quarterly=self.quarterly, family=self.family.public(),
                  siblings=[self.sib_public(x, s) for x in sorted(self.sibs.values(), key=lambda x: (-x.age, x.cid))],
                  familyLog=self.family.log[-120:], vote=self.vote_public(), me=self.me(s) if s else None,
                  orphans=[x.cid for x in self.sibs.values() if x.alive and not self.online(x)] if not s else [])
        return st

    def push(self):
        for mm in list(self.room.members.values()):
            if mm.online:
                mm.send("g:state", state=self.state_for(mm))
