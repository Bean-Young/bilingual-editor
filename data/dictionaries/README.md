# Public Dictionary Sources

## CC-CEDICT

`cedict_1_0_ts_utf-8_mdbg.txt.gz` is the MDBG distribution of CC-CEDICT.

- Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- License: Creative Commons Attribution-ShareAlike 4.0 International
- Project information: https://cc-cedict.org/wiki/

The frontend term subset in `src/translation/publicZhEnTerms.js` is generated from this file with:

```bash
node scripts/build-cedict-subset.mjs
```
