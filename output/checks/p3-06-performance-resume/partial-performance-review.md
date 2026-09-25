# Partial performance diagnostic

Both formal attempts remain **FAIL / incomplete**. Attempt 3 retains 10/63 reports (9 valid); attempt 4 retains 41/63 (40 valid). Both completed all 84 resource pages with no failed script/image bodies. The invalid pages remain in place: attempt 3 zh-CN/home/1 and attempt 4 ja/artist/2. The second failure cause is **unknown**, under root investigation.

Attempt 4 has 13 complete three-run groups. Only en/artist, zh-CN/home and vi/artist meet all three lab gates; the other 10 complete groups miss at least one. Seven groups overlap the baseline. No incomplete group is assigned a median and no samples are spliced between attempts.

| Group | Baseline LCP median ms | Attempt 4 median ms | Delta | Font requests before → after | Font transfer bytes before → after | Partial group gates |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| en/home | 2843.0 | 2836.0 | -0.2% | 2 → 2 | 61360 → 61360 | FAIL |
| en/artist | 2318.8 | 1961.2 | -15.4% | 2 → 2 | 61360 → 61360 | PASS |
| en/gift | 2624.6 | 2617.2 | -0.3% | 2 → 2 | 61360 → 61360 | FAIL |
| ja/home | 2780.5 | 3382.2 | +21.6% | 22 → 4 | 542931 → 174170 | FAIL |
| zh-CN/home | 3159.9 | 2462.2 | -22.1% | 15 → 6 | 908723 → 376107 | PASS |
| zh-CN/artist | 4658.9 | 4066.9 | -12.7% | 14 → 11 | 846899 → 670295 | FAIL |
| zh-CN/gift | 2706.9 | 4959.7 | +83.2% | 12 → 9 | 724747 → 556871 | FAIL |

The 9 shared 390×844 resource pages have identical JS totals in attempts 3 and 4. Each saves 152,421 gzip bytes and four script requests versus baseline: home 304,791 → 152,370; artist 302,448 → 150,027; gift 307,789 → 155,368. **All remain above the exclusive 150,000-byte SHOULD recommendation.** Font bytes come from actual LHR network rows, separately from the script/image resource pass.

Japanese artist has one valid candidate sample: 8 font requests / 241,970 transfer bytes versus the stable baseline 23 / 562,431, but its second sample is invalid and the third is absent. Japanese gift has no candidate LHR sample. Neither gets a completed LCP comparison.

Font traffic decreased for measured CJK pages, while Chinese gift and Japanese home LCP medians increased. These results cannot support a claim that performance budgets passed or that every page improved. All 51 reports and 168 resource-page records remain in their original folders. `partial-performance-review.json` records both source-report hashes, all 51 LHR summaries, the shared mobile resource records, settings compatibility, raw invalid values and comparison details; original reports were not edited.
