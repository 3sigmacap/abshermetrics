#!/usr/bin/env python3
"""
Mark raw shots as excluded from the modeled metadata.

A raw shot in raw-shots.json is "excluded" if it has NO counterpart in shots.json's
per-club stats[] (i.e. it was dropped during cleaning). Matching is done per club on
NON-LATERAL fingerprint fields only, because one Gap Wedge session was realigned
(a lateral aim offset), which shifts dev/ld/axis in shots.json vs the raw data.

Re-run this whenever shots.json or raw-shots.json changes:
    python3 flag_excluded.py            # writes raw-shots.json in place
    python3 flag_excluded.py --check    # report only, do not write
"""
import json, sys, copy

RAW='raw-shots.json'
CLEAN='shots.json'
# Fields unaffected by a lateral realignment. (Exclude dev, ld, axis.)
KEYS=['bs','carry','apex','spin','la','total','bspin']

def close(r,c):
    for k in KEYS:
        if k in r and k in c and r[k] is not None and c[k] is not None:
            tol = 0.11 if k in ('spin','bspin','sspin') else 0.06
            if abs(float(r[k])-float(c[k]))>tol:
                return False
    return True

def main():
    check = '--check' in sys.argv
    raw=json.load(open(RAW))
    clean_by_club={c['club']:c['stats'] for c in json.load(open(CLEAN))}

    shots=raw['shots']
    # group raw indices by club
    by_club={}
    for i,s in enumerate(shots):
        by_club.setdefault(s['club'],[]).append(i)

    excluded_idx=set()
    leftover_total=0
    report=[]
    for club, idxs in by_club.items():
        cls=clean_by_club.get(club, [])
        used=[False]*len(cls)
        excl=[]
        for i in idxs:
            s=shots[i]
            hit=-1
            for j,c in enumerate(cls):
                if not used[j] and close(s,c):
                    hit=j; break
            if hit>=0:
                used[hit]=True
            else:
                excluded_idx.add(i); excl.append(i)
        leftover=used.count(False)
        leftover_total+=leftover
        report.append((club,len(idxs),len(cls),len(excl),leftover))

    # sanity: total clean should equal total raw minus excluded, and no leftovers
    total_raw=len(shots)
    total_clean=sum(len(v) for v in clean_by_club.values())
    print(f"{'club':15} raw clean excl leftover")
    for r in sorted(report):
        print(f"{r[0]:15} {r[1]:3} {r[2]:5} {r[3]:4} {r[4]:6}")
    print(f"\nraw={total_raw} clean={total_clean} excluded={len(excluded_idx)} "
          f"(expected {total_raw-total_clean}) leftover={leftover_total}")
    assert leftover_total==0, "FAIL: some clean rows had no raw match — matching is unreliable, do not write."
    assert len(excluded_idx)==total_raw-total_clean, "FAIL: excluded count != raw-clean."

    # write flags
    for i,s in enumerate(shots):
        if i in excluded_idx:
            s['excluded']=True
        else:
            s.pop('excluded', None)  # keep file clean: only excluded shots carry the flag

    if check:
        print("\n--check: no file written.")
        return
    json.dump(raw, open(RAW,'w'), ensure_ascii=True, indent=1)
    print(f"\nWrote {RAW} with {len(excluded_idx)} shots flagged excluded:true")

if __name__=='__main__':
    main()
