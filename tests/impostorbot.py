"""Impostor: the three modes (Classic, Undercover, Questions), the Jester and Detective roles,
⭐ clue stars, the round history and the end-of-game results. Also checks that nothing secret
reaches the wrong player: the impostor never sees the word (Classic), never learns they're the
impostor before being caught (Undercover / Questions), and answers stay hidden until everyone
has answered. Old rooms that never pick a mode still play Classic."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, time
from wsbot import WS


def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        check.failed += 1
check.failed = 0


class Bot:
    def __init__(self, uid, name):
        self.uid, self.name = uid, name
        self.ws = WS()
        self.st = None
        self.toasts = []
        self.chat = []
        self.seen = []        # every state's round part as JSON, to look for leaks

    async def connect(self):
        await self.ws.connect(self.uid, self.name)
        await self.ws.wait("welcome")

    def pump(self):
        for m in self.ws.drain():
            if m["t"] == "g:state":
                self.st = m["state"]
                if self.st.get("r"):
                    self.seen.append((self.st["phase"], json.dumps(self.st["r"], ensure_ascii=False)))
            elif m["t"] == "g:toast":
                self.toasts.append(m)
            elif m["t"] == "chat":
                self.chat.append(m)

    @property
    def r(self):
        return (self.st or {}).get("r") or {}


async def until(bots, cond, timeout=20, label=""):
    end = time.time() + timeout
    while time.time() < end:
        for b in bots:
            b.pump()
        try:
            if cond():
                return True
        except (KeyError, TypeError, AttributeError):
            pass
        await asyncio.sleep(0.05)
    print("   (timed out waiting for", label or "a condition", ")")
    return False


async def room(prefix, n, settings):
    bots = [Bot(f"imp{prefix}{i:05d}", f"{prefix}{i}") for i in range(n)]
    for b in bots:
        await b.connect()
    host = bots[0]
    host.ws.send({"t": "room:create", "game": "impostor"})
    code = (await host.ws.wait("room:joined"))["code"]
    for b in bots[1:]:
        b.ws.send({"t": "room:join", "code": code, "game": "impostor"})
        await b.ws.wait("room:joined")
    if settings:
        host.ws.send({"t": "g:settings", **settings})
    await asyncio.sleep(0.3)
    for b in bots:
        b.pump()
    return bots


def close(bots):
    for b in bots:
        b.ws.task.cancel()
        b.ws.w.close()


def by_uid(bots):
    return {b.uid: b for b in bots}


async def give_clues(bots, clue_for):
    """Whoever's turn it is gives a clue until the discussion starts."""
    host = bots[0]
    ids = by_uid(bots)
    end = time.time() + 60
    last = None
    while time.time() < end:
        for b in bots:
            b.pump()
        if host.st["phase"] == "discuss":
            return True
        if host.st["phase"] == "clue":
            turn = host.r.get("turn")
            key = (turn, host.r.get("clueRound"), len(host.r["clues"].get(turn, [])))
            if turn and key != last:
                last = key
                ids[turn].ws.send({"t": "g:clue", "text": clue_for(ids[turn])})
        await asyncio.sleep(0.05)
    return False


async def classic_game():
    """4 players, settings sent the old way (no mode), Detective on, Jester on (needs 5, so not given)."""
    bots = await room("C", 4, {"rounds": 3, "clueRounds": 1, "clueTime": 15, "voteTime": 20, "detective": True, "jester": True})
    host = bots[0]
    check(host.st["settings"]["mode"] == "classic", "a room that never picks a mode plays Classic")
    host.ws.send({"t": "g:start"})
    ok = await until(bots, lambda: all(b.st["phase"] == "role" and b.r for b in bots), 8, "the role cards")
    check(ok, "classic: the game starts with the role cards")
    imp = [b for b in bots if b.r["role"] == "impostor"]
    dets = [b for b in bots if b.r["role"] == "detective"]
    check(len(imp) == 1, "classic: exactly one player is told they're the impostor")
    check(len(dets) == 1, "classic: with 4 players and Detective on, there's one Detective")
    check(not any(b.r["role"] == "jester" for b in bots) and not host.r["extras"]["jester"], "classic: no Jester with only 4 players")
    imp = imp[0]
    det = dets[0]
    crew = [b for b in bots if b is not imp]
    word = crew[0].r["word"]
    check(word and all(b.r["word"] == word for b in crew), "classic: the crew (and the Detective) all see the same word")
    check(imp.r["word"] is None, "classic: the impostor gets no word")
    ok = await give_clues(bots, lambda b: f"hint{b.name}")
    check(ok, "classic: everyone gives a clue, then the discussion starts")
    await until(bots, lambda: det.r.get("hint"), 3, "the detective's hint")
    hint = det.r.get("hint")
    check(hint and hint != imp.uid and hint != det.uid, "classic: the Detective's hint names someone who is NOT the impostor")
    check(any(t["text"].startswith("🔎 Detective hint") for t in det.toasts), "classic: the Detective gets the hint as a private message too")
    check(all(b.r.get("hint") is None and b.r.get("detective") is None for b in bots if b is not det), "classic: nobody else sees the hint or who the Detective is")
    # stars: two players star the same crew member; you can't star yourself
    star_to = crew[1] if crew[0] is not crew[1] else crew[2]
    bots[0].ws.send({"t": "g:star", "target": bots[0].uid})
    for b in bots:
        if b is not star_to and b is not bots[0]:
            b.ws.send({"t": "g:star", "target": star_to.uid})
    want = len([b for b in bots if b is not star_to and b is not bots[0]])
    await until(bots, lambda: host.r["stars"].get(star_to.uid, 0) == want, 3, "stars")
    check(host.r["stars"].get(star_to.uid, 0) == want and bots[0].uid not in host.r["stars"], "classic: stars count up, and you can't star your own clue")
    host.ws.send({"t": "g:skipDiscussion"})
    await until(bots, lambda: host.st["phase"] == "vote", 3, "the vote")
    for b in crew:
        b.ws.send({"t": "g:vote", "target": imp.uid})
    imp.ws.send({"t": "g:vote", "target": "skip"})
    ok = await until(bots, lambda: host.st["phase"] == "guess", 5, "the guess")
    check(ok, "classic: the caught impostor gets a last guess")
    imp.ws.send({"t": "g:guess", "text": "definitely not it"})
    ok = await until(bots, lambda: host.st["phase"] == "reveal", 5, "the reveal")
    r = host.r
    check(ok and r["winner"] == "crew", "classic: a wrong guess means the crew wins")
    exp = 100 + 50 + (25 * want if True else 0)
    check(r["gained"][star_to.uid] == exp, f"classic: a crew player gets right vote + crew win + stars ({r['gained'][star_to.uid]} == {exp})")
    check(r["gained"][imp.uid] == 0, "classic: the caught impostor gets nothing")
    check(r["impostors"] == [imp.uid] and r["detective"] == det.uid, "classic: the reveal shows the impostor and the Detective")
    check(r["why"][star_to.uid] and any("⭐" in w[0] for w in r["why"][star_to.uid]), "classic: the reveal says why everyone got their points")
    secret = [(ph, js) for ph, js in imp.seen if ph != "reveal" and f'"{word}"' in js]
    check(not secret, "classic: the impostor never received the word before the reveal")
    await until(bots, lambda: host.st["phase"] == "role" and host.r["n"] == 2, 20, "round 2")
    check(len(host.st["history"]) == 1 and host.st["history"][0]["winner"] == "crew", "classic: the round history keeps round 1")
    host.ws.send({"t": "g:end"})
    ok = await until(bots, lambda: host.st["phase"] == "over" and host.st.get("results"), 5, "the results")
    res = host.st["results"]
    check(ok and len(res["rows"]) == 4 and len(res["history"]) == 1, "classic: the end shows everyone's results and the rounds played")
    titles = {a["title"]: a for a in res["awards"]}
    check("Sharpest eye" in titles and "Best clue-giver" in titles and titles["Best clue-giver"]["ids"] == [star_to.uid],
          "classic: awards for the most right votes and the most stars")
    row = next(x for x in res["rows"] if x["id"] == star_to.uid)
    check(row["stars"] == want and row["correctVotes"] == 1, "classic: the results count stars and right votes")
    close(bots)


async def undercover_game():
    bots = await room("U", 4, {"mode": "undercover", "rounds": 3, "clueRounds": 1, "clueTime": 15, "voteTime": 20})
    host = bots[0]
    check(host.st["settings"]["mode"] == "undercover", "the host can pick Undercover mode")
    host.ws.send({"t": "g:start"})
    ok = await until(bots, lambda: all(b.st["phase"] == "role" and b.r for b in bots), 8, "the role cards")
    check(ok and all(b.r["role"] == "crew" for b in bots), "undercover: nobody is told they're the impostor")
    words = [b.r["word"] for b in bots]
    odd = [b for b in bots if words.count(b.r["word"]) == 1]
    check(len(set(words)) == 2 and len(odd) == 1, "undercover: one player has a different word")
    imp = odd[0]
    crew_word = next(w for w in words if w != imp.r["word"])
    imp_word = imp.r["word"]
    check(all(b.r["category"] for b in bots), "undercover: everyone sees the category")
    # the undercover can't say their own word either
    await until(bots, lambda: host.st["phase"] == "clue", 8, "the clues")
    ids = by_uid(bots)
    await until(bots, lambda: host.r["turn"] == imp.uid or True, 1)
    said = {}

    def clue_for(b):
        if b is imp and not said.get("leak"):
            said["leak"] = True
            return imp_word
        return f"hint{b.name}"
    ok = await give_clues(bots, clue_for)
    check(ok, "undercover: everyone gives a clue")
    check(any(t.get("bad") and "can't contain" in t["text"] for t in imp.toasts), "undercover: the impostor's clue can't contain their own word")
    host.ws.send({"t": "g:skipDiscussion"})
    await until(bots, lambda: host.st["phase"] == "vote", 3, "the vote")
    for b in bots:
        if b is not imp:
            b.ws.send({"t": "g:vote", "target": imp.uid})
    imp.ws.send({"t": "g:vote", "target": "skip"})
    ok = await until(bots, lambda: host.st["phase"] == "guess" and imp.r.get("role") == "impostor", 5, "the guess")
    check(ok, "undercover: once caught, the impostor learns they were the undercover")
    check(all(b.r["role"] != "impostor" for b in bots if b is not imp), "undercover: nobody else becomes an impostor")
    leaked = [ph for ph, js in imp.seen if ph not in ("reveal",) and f'"{crew_word}"' in js]
    check(not leaked, "undercover: the impostor never received the crew's word")
    imp.ws.send({"t": "g:guess", "text": crew_word.lower() + "s"})
    ok = await until(bots, lambda: host.st["phase"] == "reveal", 5, "the reveal")
    r = host.r
    check(ok and r["guessOk"] and r["winner"] == "impostor", "undercover: guessing the crew's word steals the win")
    check(r["word"] == crew_word and r["impWord"] == imp_word, "undercover: the reveal shows both words")
    check(r["gained"][imp.uid] == 200, "undercover: a stolen win is +200")
    host.ws.send({"t": "g:end"})
    await until(bots, lambda: host.st["phase"] == "over", 5, "the end")
    close(bots)


async def questions_game():
    bots = await room("Q", 5, {"mode": "questions", "rounds": 3, "clueTime": 15, "voteTime": 20, "jester": True})
    host = bots[0]
    host.ws.send({"t": "g:start"})
    ok = await until(bots, lambda: all(b.st["phase"] == "role" and b.r for b in bots), 8, "the role cards")
    check(ok and not any(b.r["role"] == "impostor" for b in bots), "questions: nobody is told they're the impostor")
    qs = [b.r["question"] for b in bots]
    odd = [b for b in bots if qs.count(b.r["question"]) == 1]
    check(len(set(qs)) == 2 and len(odd) == 1, "questions: one player got a different question")
    imp = odd[0]
    crew_q = next(q for q in qs if q != imp.r["question"])
    imp_q = imp.r["question"]
    jesters = [b for b in bots if b.r["role"] == "jester"]
    check(len(jesters) == 1 and jesters[0] is not imp, "questions: with 5 players and Jester on, one crew member is the Jester")
    jester = jesters[0]
    check(all(b.r.get("jester") is None for b in bots if b is not jester), "questions: only the Jester knows who the Jester is")
    ok = await until(bots, lambda: host.st["phase"] == "answer", 10, "answer time")
    check(ok, "questions: after the cards comes answer time (everyone at once)")
    first, rest = bots[1], [b for b in bots if b is not bots[1]]
    first.ws.send({"t": "g:answer", "text": "seven"})
    await until(bots, lambda: first.uid in (host.r.get("answered") or []), 3, "the first answer")
    check(host.r["clues"][first.uid] == ["…"] and first.r["clues"][first.uid] == ["seven"], "questions: answers stay hidden from the others until everyone has answered")
    first.ws.send({"t": "g:answer", "text": "changed"})
    for i, b in enumerate(rest):
        b.ws.send({"t": "g:answer", "text": f"answer {i}"})
    ok = await until(bots, lambda: all(b.st["phase"] == "discuss" for b in bots), 5, "the discussion")
    check(ok, "questions: once everyone has answered, the discussion starts")
    check(host.r["clues"][first.uid] == ["seven"], "questions: your first answer is locked in")
    check(all(b.r["realQuestion"] == crew_q for b in bots), "questions: everyone (the impostor too) now sees the crew's question")
    leaked = [ph for ph, js in imp.seen if ph in ("role", "answer") and crew_q in js]
    check(not leaked, "questions: the impostor never saw the crew's question while answering")
    host.ws.send({"t": "g:skipDiscussion"})
    await until(bots, lambda: host.st["phase"] == "vote", 3, "the vote")
    for b in bots:
        if b is not jester:
            b.ws.send({"t": "g:vote", "target": jester.uid})
    jester.ws.send({"t": "g:vote", "target": imp.uid})
    ok = await until(bots, lambda: host.st["phase"] == "reveal", 5, "the reveal")
    r = host.r
    check(ok and r["winner"] == "jester", "questions: voting out the Jester means the Jester wins")
    check(r["gained"][jester.uid] == 300 + 100, f"questions: the Jester gets +300 (and +100 for spotting the impostor) = {r['gained'][jester.uid]}")
    check(r["gained"][imp.uid] == 100, "questions: the impostor slips away with +100")
    check(all(r["gained"][b.uid] == 0 for b in bots if b not in (jester, imp)), "questions: the crew gets nothing when the Jester fools them")
    check(r["question"] == crew_q and r["impQuestion"] == imp_q, "questions: the reveal shows both questions")
    # round 2: catch the impostor this time: no last guess in Question mode
    ok = await until(bots, lambda: host.st["phase"] == "role" and host.r["n"] == 2, 20, "round 2")
    qs = [b.r["question"] for b in bots]
    imp = next(b for b in bots if qs.count(b.r["question"]) == 1)
    await until(bots, lambda: host.st["phase"] == "answer", 10, "answer time")
    for b in bots:
        b.ws.send({"t": "g:answer", "text": "same"})
    await until(bots, lambda: host.st["phase"] == "discuss", 5, "the discussion")
    host.ws.send({"t": "g:skipDiscussion"})
    await until(bots, lambda: host.st["phase"] == "vote", 3, "the vote")
    for b in bots:
        b.ws.send({"t": "g:vote", "target": imp.uid if b is not imp else "skip"})
    ok = await until(bots, lambda: host.st["phase"] in ("reveal", "guess"), 5, "the reveal")
    check(ok and host.st["phase"] == "reveal" and host.r["winner"] == "crew", "questions: a caught impostor loses straight away (no word to guess)")
    host.ws.send({"t": "g:end"})
    ok = await until(bots, lambda: host.st["phase"] == "over" and host.st.get("results"), 5, "the results")
    res = host.st["results"]
    check(ok and len(res["history"]) == 2 and [h["winner"] for h in res["history"]] == ["jester", "crew"], "questions: the results list both rounds")
    check(any(a["title"] == "Chief clown" and a["ids"] == [jester.uid] for a in res["awards"]), "questions: the Jester gets the Chief clown award")
    close(bots)


async def main():
    await classic_game()
    await undercover_game()
    await questions_game()
    print("FAILED:", check.failed)


if __name__ == "__main__":
    asyncio.run(main())
