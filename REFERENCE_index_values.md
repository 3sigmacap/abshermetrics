# index.html hardcoded values — reference snapshot (pre-refactor)

## Hero strip / kicker
- kicker: "11 clubs · 234 shots"
- Longest carry (3W): 271
- Shortest carry (SW): 99
- Clubs tracked: 11
- Shots analyzed: 234
- foot: "234 shots"

## Club summary table (display order, longest first)
club            loft   carry  ±SD    ball  launch  spin   apex  latSD   (red?)
3 Wood          15     271    10.3   163   12.9    3,297  120   40.5    RED
3 Iron          20     225    5.9    142   13.5    3,938  102   17.3
4 Iron          23     213    6.4    139   14.6    4,487  106   14.8   (data=4488)
5 Iron          26     201    5.1    134   17.4    5,115  121   12.7
6 Iron          30     187    3.7    131   19.2    6,188  126   11.3
7 Iron          34     170    5.3    124   22.6    7,121  133   10.2
8 Iron          39     158    2.5    119   24.6    8,033  132   12.4   (data launch=24.5)
9 Iron          42.5   143    3.7    111   26.9    8,677  126   8.5
Pitching Wedge  47     128    3.2    104   29.5    9,270  118   6.3
Gap Wedge       52     108    4.1    90    34.2    8,098  104   20.5    RED
Sand Wedge      56     99     3.6    87    35.8    9,004  100   5.0

## Gaps (between consecutive rows top->down)
3W->3I 46 | 3I->4I 12 | 4I->5I 12 | 5I->6I 14 | 6I->7I 17 | 7I->8I 12
8I->9I 15 | 9I->PW 15 | PW->GW 20 | GW->SW 9

## Derivation (ALL reproduce from shots.json[].stats except loft & red-flag):
- carry  = round(mean(stats.carry))
- ±SD    = round(stdev(stats.carry), 1)        [sample stdev]
- ball   = round(mean(stats.bs))
- launch = round(mean(stats.la), 1)
- spin   = round(mean(stats.spin))             [comma-formatted]
- apex   = round(mean(stats.apex))
- latSD  = round(stdev(stats.dev), 1)          [sample stdev] == ell.rz
- n/shots= len(stats);  total = sum(len(stats))
- gap    = carry[i] - carry[i+1]
- loft   = STATIC per-club spec (not in data)
- RED    = STATIC flagged set {3 Wood, Gap Wedge} (editorial two-way-miss call,
           NOT a lateral-SD threshold — GW's 11.1 is below 4 non-red clubs)

## Two cases where current hardcode != actual data (live JS will show the corrected value):
- 8 Iron launch: hardcoded 24.6, data mean = 24.54 -> 24.5
- 4 Iron spin:   hardcoded 4,487, data mean = 4487.5 -> Math.round = 4,488
